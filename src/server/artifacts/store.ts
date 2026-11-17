/**
 * Build once, then serve from blob storage (#46 slice 6). The one path every server-built file
 * (a configuration's GLB / PDF / CSV, a job's bundle ZIP) is stored through:
 *
 * 1. **Cached:** the `artifact` row for the key exists and so does its object → nothing to do.
 * 2. **Otherwise**, one build per key:
 *    - in this process, concurrent requests for one key share one promise (single flight);
 *    - across processes, a transaction-level advisory lock on the key (`artifacts.lock`): the
 *      second process waits, then finds the first one's row and object.
 *    Inside the lock: build (on the engine's worker threads, never this thread), `put` the
 *    object (first, so a crash leaves an orphan for `blob:gc`, never a row with nothing behind
 *    it), upsert the row (`built_by = server`), and emit `artifact.ready` last, all in one
 *    transaction.
 *
 * Keys are content-addressed and the builds are deterministic (the date in a file is the
 * configuration's, not the clock's; see `service.ts`), so even two builds racing past every
 * guard would write the same bytes: one object, one row.
 *
 * The lock holds one pooled connection while a file builds (well under a second for one file, a
 * few seconds for a bundle); the single flight keeps that to one connection per key per process.
 */
import type { CrateEventPayload } from "@/lib/events";
import type { BlobKey } from "../blob/keys";
import { type BlobStore, EPHEMERAL_TAGS } from "../blob/store";
import { type OrgContext, requireOrg } from "../db/org";
import { type Artifact, createRepository, type Database, inTransaction, type Repository } from "../db/repository";
import type { ArtifactKind } from "../db/schema";
import { emitEvent } from "../events/emit";

export type BuiltFile = { bytes: Uint8Array; sha256: string; fileName: string; contentType: string };

export type StoreOnceInput = {
  key: BlobKey;
  kind: ArtifactKind;
  /** The configuration the row names (a bundle's first one). */
  configurationId: string;
  /** The job `artifact.ready` is emitted on. */
  jobId: string;
  build: () => Promise<BuiltFile>;
  /** Extra `artifact.ready` payload fields (small: ids, a file name). */
  event?: Record<string, unknown>;
};

export type Stored = { row: Artifact; fileName: string; contentType: string; cached: boolean };

export type StoreDeps = { db: Database; blob: BlobStore; org: OrgContext };

const inFlight = new Map<string, Promise<Stored>>();

/** The download name kept in the object's metadata (URI-encoded: S3 metadata is ASCII); the key's last part without it. */
function fileNameOf(metadata: Record<string, string> | undefined, key: BlobKey): string {
  try {
    if (metadata?.filename) return decodeURIComponent(metadata.filename);
  } catch {
    // Not ours: fall through.
  }
  return key.slice(key.lastIndexOf("/") + 1);
}

async function existing({ db, blob, org }: StoreDeps, key: BlobKey, repo: Repository = createRepository(db)): Promise<Stored | undefined> {
  const row = await repo.artifacts.getByKey(org, key);
  if (!row) return undefined;
  // A row whose object expired (lifecycle) or was removed is rebuilt, not served as a dead link.
  const info = await blob.head(key);
  if (!info) return undefined;
  return { row, fileName: fileNameOf(info.metadata, key), contentType: info.contentType ?? "application/octet-stream", cached: true };
}

async function buildAndStore(deps: StoreDeps, input: StoreOnceInput): Promise<Stored> {
  const { db, blob, org } = deps;
  return inTransaction(db, async (tx) => {
    await tx.artifacts.lock(org, input.key);
    const found = await existing(deps, input.key, tx);
    if (found) return found;
    const file = await input.build();
    await blob.put(input.key, file.bytes, {
      contentType: file.contentType,
      metadata: { filename: encodeURIComponent(file.fileName), sha256: file.sha256 },
      tags: { ...EPHEMERAL_TAGS },
    });
    const row = await tx.artifacts.put(org, {
      configurationId: input.configurationId,
      kind: input.kind,
      sha256: file.sha256,
      sizeBytes: file.bytes.byteLength,
      objectKey: input.key,
      builtBy: "server",
    });
    const payload: CrateEventPayload<"artifact.ready"> = { ...input.event, artifactId: row.id, configurationId: input.configurationId, kind: input.kind };
    await emitEvent(tx, org, { jobId: input.jobId, type: "artifact.ready", payload });
    return { row, fileName: file.fileName, contentType: file.contentType, cached: false };
  });
}

/**
 * The stored artifact at `input.key`, built and stored first if it isn't there. `shareInProcess:
 * false` skips the in-process single flight, leaving only the database lock (as between processes;
 * tests use it).
 */
export async function storeOnce(deps: StoreDeps, input: StoreOnceInput, { shareInProcess = true } = {}): Promise<Stored> {
  const cached = await existing(deps, input.key);
  if (cached) return cached;
  if (!shareInProcess) return buildAndStore(deps, input);
  const flightKey = `${requireOrg(deps.org)}\n${input.key}`;
  let flight = inFlight.get(flightKey);
  if (!flight) {
    flight = buildAndStore(deps, input).finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, flight);
  }
  return flight;
}
