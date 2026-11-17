/**
 * `BlobStore` on the S3 API (`@aws-sdk/client-s3`), so the same code runs against the compose
 * emulator, AWS S3, Cloudflare R2 and GCS's XML API. Configured from `BLOB_*` (config.ts).
 *
 * Server-only through the eslint layer rules (the SDK and credentials never reach the browser);
 * no `server-only` import so `bun run blob:gc` can use it outside Next.js.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BlobConfig } from "./config";
import type { BlobKey } from "./keys";
import { type BlobInfo, type BlobStore, PRESIGN_SECONDS } from "./store";

function clientConfig(config: BlobConfig, endpoint: string | undefined): S3ClientConfig {
  return {
    region: config.region,
    endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Only send / check the newer flexible checksums when an operation requires them: R2, GCS and
    // emulators don't all accept the SDK's default CRC32 trailers.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
}

const isMissing = (e: unknown) => e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NotFound" || e.name === "NoSuchKey");

/** `attachment; filename="…"` with an RFC 5987 fallback for non-ASCII names. */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createS3BlobStore(config: BlobConfig): BlobStore {
  const client = new S3Client(clientConfig(config, config.endpoint));
  // Presigned URLs carry the endpoint the browser will use, which may differ from the server's.
  const presigner = config.publicEndpoint === config.endpoint ? client : new S3Client(clientConfig(config, config.publicEndpoint));
  const Bucket = config.bucket;

  return {
    async put(key, body, options = {}) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: options.contentType ?? "application/octet-stream",
          Metadata: options.metadata,
          Tagging: options.tags ? new URLSearchParams(options.tags).toString() : undefined,
        }),
      );
    },

    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        const body = await out.Body!.transformToByteArray();
        const info: BlobInfo = {
          key,
          size: out.ContentLength ?? body.byteLength,
          lastModified: out.LastModified ?? new Date(0),
          etag: out.ETag,
          contentType: out.ContentType,
          metadata: out.Metadata,
        };
        return { body, info };
      } catch (e) {
        if (isMissing(e)) return undefined;
        throw e;
      }
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          key,
          size: out.ContentLength ?? 0,
          lastModified: out.LastModified ?? new Date(0),
          etag: out.ETag,
          contentType: out.ContentType,
          metadata: out.Metadata,
        };
      } catch (e) {
        if (isMissing(e)) return undefined;
        throw e;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    async presignGet(key, options = {}) {
      const expiresIn = options.expiresInSeconds ?? PRESIGN_SECONDS;
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: options.downloadName ? attachment(options.downloadName) : undefined,
      });
      const signedAt = Date.now();
      const url = await getSignedUrl(presigner, command, { expiresIn });
      return { url, expiresAt: new Date(signedAt + expiresIn * 1000) };
    },

    async *list(prefix: BlobKey) {
      let ContinuationToken: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken }));
        for (const o of page.Contents ?? []) {
          if (!o.Key) continue;
          yield { key: o.Key as BlobKey, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0), etag: o.ETag };
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
    },
  };
}
