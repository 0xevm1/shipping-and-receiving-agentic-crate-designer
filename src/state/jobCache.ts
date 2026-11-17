/**
 * The last-opened shared jobs, kept on this device (#46 slice 7a), so a job opened once can be
 * opened again with the server stopped: its configurations listed, and new saves queued against
 * it. `localStorage` holds about 5 MB per site, so this keeps JSON only (never GLBs), at most
 * `MAX_CACHED_JOBS` jobs and `MAX_CACHE_CHARS` characters, dropping the oldest first. Every
 * read and write goes through `persist.ts`, which never throws.
 */
import { z } from "zod";
import { ConfigurationSchema, JobSchema, type ConfigurationResponse, type JobResponse } from "@/lib/api/jobs";
import { browserStorage, readJson, writeJson, type KeyValueStore } from "./persist";

const CACHE_KIND = "crate-designer.job-cache";
const CACHE_VERSION = 1;
export const JOB_CACHE_STORAGE_KEY = `${CACHE_KIND}.v${CACHE_VERSION}`;
export const MAX_CACHED_JOBS = 5;
/** About 1 MB of the ~5 MB budget (JS strings are UTF-16, so this counts characters). */
export const MAX_CACHE_CHARS = 1_000_000;

const EntrySchema = z.object({
  partKey: z.string().min(1),
  savedAt: z.string(),
  job: JobSchema,
  configurations: z.array(ConfigurationSchema),
});
export type CachedJob = z.infer<typeof EntrySchema>;

function parseCache(text: string): { ok: true; value: CachedJob[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not JSON." };
  }
  const o = json as { kind?: unknown; version?: unknown; entries?: unknown };
  if (!o || o.kind !== CACHE_KIND || o.version !== CACHE_VERSION || !Array.isArray(o.entries)) return { ok: false, error: "Not a job cache." };
  return { ok: true, value: o.entries.flatMap((e) => (EntrySchema.safeParse(e).success ? [e as CachedJob] : [])) };
}

const read = (storage: KeyValueStore | null) => readJson<CachedJob[]>(storage, JOB_CACHE_STORAGE_KEY, parseCache, [], "Cached jobs ignored.");

function write(entries: CachedJob[], storage: KeyValueStore | null): boolean {
  // Newest first; drop the oldest until it fits.
  let kept = entries.slice(0, MAX_CACHED_JOBS);
  let text = JSON.stringify({ kind: CACHE_KIND, version: CACHE_VERSION, entries: kept });
  while (kept.length > 0 && text.length > MAX_CACHE_CHARS) {
    kept = kept.slice(0, -1);
    text = JSON.stringify({ kind: CACHE_KIND, version: CACHE_VERSION, entries: kept });
  }
  return writeJson(storage, JOB_CACHE_STORAGE_KEY, kept.length ? text : null, "Couldn't keep the job on this device.");
}

/** The cached job for a part, or null. */
export function cachedJob(partKey: string, storage: KeyValueStore | null = browserStorage()): CachedJob | null {
  return read(storage).find((e) => e.partKey === partKey) ?? null;
}

/** Keeps a job's snapshot for its part, as the newest entry. */
export function cacheJob(
  partKey: string,
  snap: { job: JobResponse; configurations: ConfigurationResponse[] },
  storage: KeyValueStore | null = browserStorage(),
  now = new Date(),
): boolean {
  const others = read(storage).filter((e) => e.partKey !== partKey && e.job.id !== snap.job.id);
  return write([{ partKey, savedAt: now.toISOString(), job: snap.job, configurations: snap.configurations }, ...others], storage);
}

/** Updates a cached job in place (a newer job row, a configuration added). No-op when it isn't cached. */
export function updateCachedJob(
  jobId: string,
  change: { job?: JobResponse; configuration?: ConfigurationResponse },
  storage: KeyValueStore | null = browserStorage(),
): boolean {
  const entries = read(storage);
  const i = entries.findIndex((e) => e.job.id === jobId);
  if (i < 0) return false;
  const e = entries[i]!;
  const job = change.job && change.job.version >= e.job.version ? change.job : e.job;
  const configurations = change.configuration ? [...e.configurations.filter((c) => c.id !== change.configuration!.id), change.configuration] : e.configurations;
  entries[i] = { ...e, job, configurations };
  return write(entries, storage);
}
