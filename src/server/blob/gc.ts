/**
 * Orphan cleanup (#46 §2a). Uploads write the object first and the metadata row second, so a
 * crash in between leaves an object no row names, never a row with nothing behind it. This
 * deletes such objects once they are older than `ORPHAN_AGE_MS`, which leaves in-flight uploads
 * (object written, row not yet) alone. Run by `bun run blob:gc`.
 *
 * Walks every org's keys; each batch is checked through the org-scoped repository with that
 * org's context, so even maintenance never queries without an `OrgContext`.
 */
import type { Repository } from "../db/repository";
import { type BlobKey, orgOfKey } from "./keys";
import type { BlobInfo, BlobStore } from "./store";

/** Objects with no metadata row are kept this long before cleanup deletes them. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

const BATCH = 500;

export type GcOptions = {
  store: BlobStore;
  repo: Pick<Repository, "blobRefs">;
  /** Default `ORPHAN_AGE_MS`. */
  olderThanMs?: number;
  now?: Date;
  /** Report what would be deleted without deleting it. */
  dryRun?: boolean;
  /** Only look under this prefix (one org's keys, a test's); default every org's. */
  prefix?: BlobKey;
};

export type GcResult = { scanned: number; orphans: string[]; deleted: number };

export async function collectOrphans({
  store,
  repo,
  olderThanMs = ORPHAN_AGE_MS,
  now = new Date(),
  dryRun = false,
  prefix = "org/" as BlobKey,
}: GcOptions): Promise<GcResult> {
  const cutoff = now.getTime() - olderThanMs;
  const result: GcResult = { scanned: 0, orphans: [], deleted: 0 };
  const pending = new Map<string, BlobInfo[]>();

  const flush = async (orgId: string) => {
    const batch = pending.get(orgId) ?? [];
    pending.delete(orgId);
    if (batch.length === 0) return;
    const ctx = orgOfKey(batch[0]!.key)!;
    const referenced = await repo.blobRefs.referenced(
      ctx,
      batch.map((o) => o.key),
    );
    for (const o of batch) {
      if (referenced.has(o.key)) continue;
      result.orphans.push(o.key);
      if (!dryRun) {
        await store.delete(o.key);
        result.deleted++;
      }
    }
  };

  for await (const o of store.list(prefix)) {
    result.scanned++;
    if (o.lastModified.getTime() > cutoff) continue;
    const ctx = orgOfKey(o.key);
    if (!ctx) continue; // Not a key this app writes: leave it.
    const batch = pending.get(ctx.orgId) ?? [];
    batch.push(o);
    pending.set(ctx.orgId, batch);
    if (batch.length >= BATCH) await flush(ctx.orgId);
  }
  for (const orgId of [...pending.keys()]) await flush(orgId);
  return result;
}
