/**
 * The blob store (#46 §2a): a small interface over object storage, so callers don't depend on
 * the S3 SDK and a native client (GCS, say) could be added if we ever need provider-only features.
 * `createS3BlobStore` (s3.ts) is the implementation; `getBlobStore()` (index.ts) the app's instance.
 */
import type { BlobKey } from "./keys";

export type BlobInfo = {
  key: BlobKey;
  size: number;
  lastModified: Date;
  etag?: string;
  contentType?: string;
  /** User metadata (`x-amz-meta-*`), lower-cased keys. Not filled in by `list`. */
  metadata?: Record<string, string>;
};

type PutOptions = {
  contentType?: string;
  metadata?: Record<string, string>;
  /** Object tags (`x-amz-tagging`), e.g. `EPHEMERAL_TAGS` on generated files a lifecycle rule may expire. */
  tags?: Record<string, string>;
};

/** Tags of a generated file that can be rebuilt (docs/BLOB_STORAGE.md "Lifecycle of generated files"). */
export const EPHEMERAL_TAGS: Readonly<Record<string, string>> = { retention: "ephemeral" };

type PresignOptions = {
  /** Lifetime in seconds; default `PRESIGN_SECONDS`. */
  expiresInSeconds?: number;
  /** Sets `Content-Disposition: attachment; filename=…` on the download. */
  downloadName?: string;
};

/** Presigned GETs last about five minutes: long enough to start a download, short enough to leak little. */
export const PRESIGN_SECONDS = 300;

export interface BlobStore {
  put(key: BlobKey, body: Uint8Array, options?: PutOptions): Promise<void>;
  /** The object's bytes and info, or undefined when there is no such object. */
  get(key: BlobKey): Promise<{ body: Uint8Array; info: BlobInfo } | undefined>;
  /** The object's info, or undefined when there is no such object. */
  head(key: BlobKey): Promise<BlobInfo | undefined>;
  /** Deletes the object; deleting a missing object is not an error. */
  delete(key: BlobKey): Promise<void>;
  /** A short-lived URL the browser can GET without credentials. */
  presignGet(key: BlobKey, options?: PresignOptions): Promise<{ url: string; expiresAt: Date }>;
  /** Every object under `prefix`, in key order, page by page. */
  list(prefix: BlobKey): AsyncIterable<BlobInfo>;
}
