/**
 * Where the blob store is (#46 §2a), from the `BLOB_*` environment variables. The defaults match
 * the SeaweedFS emulator in docker-compose.yml; pointing them at AWS S3, Cloudflare R2 or GCS's
 * S3-compatible XML API (HMAC keys) needs no code change (docs/BLOB_STORAGE.md).
 *
 * Server-only (eslint keeps src/server out of the browser layers), but no `server-only` import:
 * `bun run blob:gc` reads it outside Next.js. Never expose these values with `NEXT_PUBLIC_`.
 */

/** Matches docker-compose.yml. Local-only credentials; never use them for a hosted bucket. */
export const LOCAL_BLOB = {
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  bucket: "crate-designer-dev",
  accessKeyId: "crate-dev",
  secretAccessKey: "crate-dev-secret",
} as const;

export type BlobConfig = {
  /** S3 endpoint the server talks to; unset (`""`) means AWS S3's own endpoint for the region. */
  endpoint: string | undefined;
  /** Endpoint written into presigned URLs, for when the browser reaches the store by another host. */
  publicEndpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style URLs (`host/bucket/key`); emulators need them, AWS prefers virtual-hosted. */
  forcePathStyle: boolean;
};

type Env = Readonly<Record<string, string | undefined>>;

export function blobConfig(env: Env = process.env): BlobConfig {
  // An explicit empty BLOB_ENDPOINT means "the provider's default" (AWS S3).
  const endpoint = env.BLOB_ENDPOINT === undefined ? LOCAL_BLOB.endpoint : env.BLOB_ENDPOINT || undefined;
  return {
    endpoint,
    publicEndpoint: env.BLOB_PUBLIC_ENDPOINT || endpoint,
    region: env.BLOB_REGION || LOCAL_BLOB.region,
    bucket: env.BLOB_BUCKET || LOCAL_BLOB.bucket,
    accessKeyId: env.BLOB_ACCESS_KEY_ID || LOCAL_BLOB.accessKeyId,
    secretAccessKey: env.BLOB_SECRET_ACCESS_KEY || LOCAL_BLOB.secretAccessKey,
    forcePathStyle: (env.BLOB_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
  };
}
