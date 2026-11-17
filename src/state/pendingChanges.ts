/**
 * The offline queue's storage (#46 slice 7a, docs/API.md "Offline"): every save to a shared job
 * (a configuration, a recommendation, a note or status) is written here as a *pending change*
 * before any network call, with a client-generated id that the server takes as its
 * `Idempotency-Key`. `pendingSync.ts` sends them, oldest first, when the server is reachable and
 * removes each one once the server confirms it.
 *
 * The list lives behind `PendingStore`, two calls (read the list, write the list), so IndexedDB
 * could replace `localStorage` without touching the rest. Every read and write is wrapped:
 * private windows and full storage throw. When the browser refuses to store the list it is kept
 * in memory for this page and `persisted` turns false, so the UI can say it won't survive a reload.
 *
 * Several tabs share one list. Each change is a read-modify-write of the stored list (never a
 * write of this tab's copy), and the `storage` event tells the other tabs to re-read it.
 */
import { create } from "zustand";
import { z } from "zod";
import { JobSchema, SaveConfigurationRequestSchema, type JobResponse, type SaveConfigurationRequest } from "@/lib/api/jobs";
import { browserStorage, readJson, writeJson, type KeyValueStore } from "./persist";

const PENDING_KIND = "crate-designer.pending-changes";
const PENDING_VERSION = 1;
export const PENDING_STORAGE_KEY = `${PENDING_KIND}.v${PENDING_VERSION}`;

/**
 * Where a change stands:
 * - `pending`: waiting to be sent (or being sent);
 * - `conflict`: a job change the server refused because the job moved on (`409 version_conflict`);
 *   `serverJob` is the job as it is now, and the user keeps theirs or takes the server's;
 * - `stale`: a configuration made by another engine version whose result the running engine no
 *   longer agrees with; `redesigned` is what this engine makes of the same request (null when it
 *   can't); the user saves that or discards the change;
 * - `rejected`: the server said no for another reason (`message`); the user discards it.
 */
export type PendingState = "pending" | "conflict" | "stale" | "rejected";

const JOB_STATUSES = ["open", "running", "ready", "error", "archived"] as const;

/** A recommendation names a saved configuration by id, or one still pending by its `inputHash`. */
const SelectionSchema = z.union([z.object({ configurationId: z.uuid() }), z.object({ inputHash: z.string().min(1) }), z.null()]);
export type Selection = z.infer<typeof SelectionSchema>;

const JobChangesSchema = z.object({
  select: SelectionSchema.optional(),
  status: z.enum(JOB_STATUSES).optional(),
  notes: z.string().max(4000).nullable().optional(),
  totalQuantity: z.int().positive().max(1_000_000).nullable().optional(),
});
export type JobChanges = z.infer<typeof JobChangesSchema>;

const BaseSchema = z.object({
  /** Client-generated; sent as the `Idempotency-Key`. */
  id: z.string().min(1).max(200),
  createdAt: z.string(),
  /** The job, or null while the part's job isn't known yet (picked while offline). */
  jobId: z.uuid().nullable(),
  /** The part's identity (`partKey` in jobSync), so a change made before the job was known finds it. */
  partKey: z.string().min(1),
  /** For the marker: which part this is. */
  partName: z.string(),
  state: z.enum(["pending", "conflict", "stale", "rejected"]),
  message: z.string().optional(),
});

const PendingConfigSchema = BaseSchema.extend({
  kind: z.literal("config"),
  body: SaveConfigurationRequestSchema,
  redesigned: SaveConfigurationRequestSchema.nullable().optional(),
});

const PendingPatchSchema = BaseSchema.extend({
  kind: z.literal("patch"),
  /** The job `version` the change was made on; sent as `version`. */
  baseVersion: z.int().positive(),
  changes: JobChangesSchema,
  serverJob: JobSchema.optional(),
});

const PendingChangeSchema = z.discriminatedUnion("kind", [PendingConfigSchema, PendingPatchSchema]);
export type PendingChange = z.infer<typeof PendingChangeSchema>;
export type PendingConfig = z.infer<typeof PendingConfigSchema>;
export type PendingPatch = z.infer<typeof PendingPatchSchema>;

/** Where the list is kept. `read` is null when the store can't be read (missing, throws). */
export interface PendingStore {
  read(): PendingChange[] | null;
  /** False when the store refused the write (missing, quota, blocked). Never throws. */
  write(items: PendingChange[]): boolean;
}

/** The list as stored: an envelope, so a future format can be told apart. Bad entries are skipped. */
function parsePending(text: string): { ok: true; value: PendingChange[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not JSON." };
  }
  const o = json as { kind?: unknown; version?: unknown; items?: unknown };
  if (!o || o.kind !== PENDING_KIND || o.version !== PENDING_VERSION || !Array.isArray(o.items)) return { ok: false, error: "Not a pending-changes list." };
  const items: PendingChange[] = [];
  for (const raw of o.items) {
    const r = PendingChangeSchema.safeParse(raw);
    if (r.success) items.push(r.data);
    else console.warn("Skipped a pending change that couldn't be read.", r.error.issues[0]?.message);
  }
  return { ok: true, value: items };
}

/** `localStorage` (or any key-value store) as a `PendingStore`. */
export function localPendingStore(storage: () => KeyValueStore | null = browserStorage): PendingStore {
  return {
    read() {
      const s = storage();
      if (!s) return null;
      let text: string | null;
      try {
        text = s.getItem(PENDING_STORAGE_KEY);
      } catch {
        return null;
      }
      if (text === null) return [];
      return readJson<PendingChange[]>(s, PENDING_STORAGE_KEY, parsePending, [], "Pending changes ignored.");
    },
    write(items) {
      const text = items.length ? JSON.stringify({ kind: PENDING_KIND, version: PENDING_VERSION, items }) : null;
      return writeJson(storage(), PENDING_STORAGE_KEY, text, "Couldn't store the unsynced changes on this device.");
    },
  };
}

/** A store in memory only (tests, or a browser with no storage). */
export function memoryPendingStore(initial: PendingChange[] = []): PendingStore & { items: PendingChange[] } {
  const s = {
    items: initial,
    read: () => s.items,
    write: (items: PendingChange[]) => {
      s.items = items;
      return true;
    },
  };
  return s;
}

export interface PendingChangesState {
  /** Oldest first: the order they are sent in. */
  items: PendingChange[];
  /** False when the last write was refused: the list is only in this page's memory. */
  persisted: boolean;
}

export const usePendingChanges = create<PendingChangesState>()(() => ({ items: [], persisted: true }));

let store: PendingStore = localPendingStore();
/** This page's copy, used when the store can't be read. */
let memory: PendingChange[] = [];

/** Swap the store (tests; IndexedDB later). Re-reads it. */
export function setPendingStore(next: PendingStore): void {
  store = next;
  memory = [];
  usePendingChanges.setState({ persisted: true });
  reloadPending();
}

/** Re-reads the stored list, e.g. after another tab changed it (`storage` event). */
export function reloadPending(): void {
  const read = store.read();
  if (read) memory = read;
  usePendingChanges.setState({ items: memory });
}

/** Read-modify-write of the stored list, so another tab's changes are never overwritten. */
function mutate(fn: (items: PendingChange[]) => PendingChange[]): void {
  // After a refused write the stored list is behind this page's copy: build on the copy.
  const base = (usePendingChanges.getState().persisted ? store.read() : null) ?? memory;
  const next = fn(base);
  memory = next;
  const persisted = store.write(next);
  usePendingChanges.setState({ items: next, persisted });
}

/** A new id for a change (the idempotency key). */
export function newChangeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // randomUUID needs a secure context; plain http on a LAN IP doesn't have one.
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

type NewConfig = Omit<PendingConfig, "id" | "createdAt" | "state" | "kind"> & { body: SaveConfigurationRequest };
type NewPatch = Omit<PendingPatch, "id" | "createdAt" | "state" | "kind">;

/** Appends a change, pending, and returns it. */
export function enqueueConfig(c: NewConfig, now = new Date()): PendingConfig {
  const change: PendingConfig = { ...c, kind: "config", id: newChangeId(), createdAt: now.toISOString(), state: "pending" };
  mutate((items) => [...items, change]);
  return change;
}

export function enqueuePatch(c: NewPatch, now = new Date()): PendingPatch {
  const change: PendingPatch = { ...c, kind: "patch", id: newChangeId(), createdAt: now.toISOString(), state: "pending" };
  mutate((items) => [...items, change]);
  return change;
}

/** Changes one entry in place (by id); no-op when it is gone (another tab sent it). */
export function updateChange(id: string, fn: (c: PendingChange) => PendingChange): void {
  mutate((items) => items.map((c) => (c.id === id ? fn(c) : c)));
}

export function removeChange(id: string): void {
  mutate((items) => items.filter((c) => c.id !== id));
}

/** Fills in the job of changes made before the part's job was known. */
export function assignJob(partKey: string, jobId: string): void {
  if (!usePendingChanges.getState().items.some((c) => c.jobId === null && c.partKey === partKey)) return;
  mutate((items) => items.map((c) => (c.jobId === null && c.partKey === partKey ? { ...c, jobId } : c)));
}

/** After a job change was confirmed at `newVersion`: later changes made on `fromVersion` now apply on top of it. */
export function rebasePatches(jobId: string, fromVersion: number, newVersion: number): void {
  mutate((items) =>
    items.map((c) =>
      c.kind === "patch" && c.jobId === jobId && c.state === "pending" && c.baseVersion === fromVersion ? { ...c, baseVersion: newVersion } : c,
    ),
  );
}

/** The changes that belong to the part on screen: its job's, and those made before the job was known. */
export function changesFor(items: PendingChange[], jobId: string | null, partKey: string | null): PendingChange[] {
  return items.filter((c) => (jobId !== null && c.jobId === jobId) || (partKey !== null && c.partKey === partKey && (c.jobId === null || jobId === null)));
}

/** The job as this device sees it: the server's, with the pending changes laid on top, oldest first. */
export function effectiveJob(
  job: JobResponse | null,
  changes: PendingChange[],
): { selected: Selection | undefined; notes: string | null | undefined; totalQuantity: number | null | undefined } {
  let selected: Selection | undefined = job ? (job.selectedConfigurationId ? { configurationId: job.selectedConfigurationId } : null) : undefined;
  let notes = job?.notes;
  let totalQuantity = job?.totalQuantity;
  for (const c of changes) {
    if (c.kind !== "patch" || c.state === "rejected") continue;
    if (c.changes.select !== undefined) selected = c.changes.select;
    if (c.changes.notes !== undefined) notes = c.changes.notes;
    if (c.changes.totalQuantity !== undefined) totalQuantity = c.changes.totalQuantity;
  }
  return { selected, notes, totalQuantity };
}
