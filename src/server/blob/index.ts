/**
 * The app's blob store (#46 §2a). Server-only: route handlers import from here; nothing below
 * src/app may (eslint), and `server-only` fails the build if a Client Component reaches it.
 */
import "server-only";
import { blobConfig } from "./config";
import { createS3BlobStore } from "./s3";
import type { BlobStore } from "./store";

const holder = globalThis as typeof globalThis & { __crateDesignerBlob?: BlobStore };

/** Created on first use (so `next build` needs no store) and kept across dev hot reloads. */
export function getBlobStore(): BlobStore {
  holder.__crateDesignerBlob ??= createS3BlobStore(blobConfig());
  return holder.__crateDesignerBlob;
}

/** Forgets the instance, so the next `getBlobStore()` reads `BLOB_*` again (tests). */
export function resetBlobStore(): void {
  holder.__crateDesignerBlob = undefined;
}
