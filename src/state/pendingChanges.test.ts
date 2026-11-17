import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveConfigurationRequest } from "@/lib/api/jobs";
import {
  assignJob,
  changesFor,
  effectiveJob,
  enqueueConfig,
  enqueuePatch,
  localPendingStore,
  memoryPendingStore,
  PENDING_STORAGE_KEY,
  rebasePatches,
  reloadPending,
  removeChange,
  setPendingStore,
  usePendingChanges,
} from "./pendingChanges";

const JOB = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000ab";
const CONFIG = "00000000-0000-4000-8000-0000000000cc";
const body = (n: number): SaveConfigurationRequest => ({ request: { n }, engineVersion: "e1", inputHash: String(n).padStart(64, "0"), summary: { n } });
const job = {
  id: JOB,
  partId: OTHER,
  status: "open",
  totalQuantity: null,
  selectedConfigurationId: null,
  notes: null,
  version: 1,
  createdAt: "",
  updatedAt: "",
} as const;

/** A localStorage stand-in; `fail` makes every call throw (a private window, a full disk). */
function fakeStorage() {
  const map = new Map<string, string>();
  const s = {
    map,
    fail: false,
    getItem: (k: string) => {
      if (s.fail) throw new Error("SecurityError");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (s.fail) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (s.fail) throw new Error("SecurityError");
      map.delete(k);
    },
  };
  return s;
}

beforeEach(() => setPendingStore(memoryPendingStore()));
afterEach(() => vi.restoreAllMocks());

describe("the pending queue", () => {
  it("keeps changes oldest first, each with its own idempotency key", () => {
    const a = enqueueConfig({ jobId: JOB, partKey: "catalog:P", partName: "P", body: body(1) });
    const b = enqueuePatch({ jobId: JOB, partKey: "catalog:P", partName: "P", baseVersion: 1, changes: { notes: "x" } });
    const c = enqueueConfig({ jobId: JOB, partKey: "catalog:P", partName: "P", body: body(2) });
    expect(usePendingChanges.getState().items.map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    removeChange(b.id);
    expect(usePendingChanges.getState().items.map((i) => i.id)).toEqual([a.id, c.id]);
  });

  it("survives a reload: a new page reads the same list from localStorage", () => {
    const storage = fakeStorage();
    setPendingStore(localPendingStore(() => storage));
    const a = enqueueConfig({ jobId: null, partKey: "catalog:P", partName: "P", body: body(1) });
    expect(storage.map.has(PENDING_STORAGE_KEY)).toBe(true);

    // "Reload": forget the page's copy, read the store again.
    usePendingChanges.setState({ items: [] });
    setPendingStore(localPendingStore(() => storage));
    expect(usePendingChanges.getState().items).toEqual([a]);
    removeChange(a.id);
    expect(storage.map.has(PENDING_STORAGE_KEY)).toBe(false); // An empty queue is stored as nothing.
  });

  it("never throws when storage does: the change is kept in memory and marked as not stored", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = fakeStorage();
    storage.fail = true;
    setPendingStore(localPendingStore(() => storage));
    const a = enqueueConfig({ jobId: JOB, partKey: "catalog:P", partName: "P", body: body(1) });
    expect(usePendingChanges.getState()).toMatchObject({ items: [a], persisted: false });
    const b = enqueueConfig({ jobId: JOB, partKey: "catalog:P", partName: "P", body: body(2) });
    expect(usePendingChanges.getState().items).toEqual([a, b]);
    // Storage that comes back gets the whole list on the next write.
    storage.fail = false;
    removeChange(a.id);
    expect(usePendingChanges.getState()).toMatchObject({ items: [b], persisted: true });
    expect(JSON.parse(storage.map.get(PENDING_STORAGE_KEY)!).items).toHaveLength(1);
  });

  it("works with no storage at all (server render, blocked)", () => {
    setPendingStore(localPendingStore(() => null));
    enqueueConfig({ jobId: JOB, partKey: "catalog:P", partName: "P", body: body(1) });
    expect(usePendingChanges.getState()).toMatchObject({ persisted: false });
    expect(usePendingChanges.getState().items).toHaveLength(1);
  });

  it("skips entries it can't read and ignores a list that isn't one", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = fakeStorage();
    const good = { id: "k1", createdAt: "t", jobId: JOB, partKey: "catalog:P", partName: "P", state: "pending", kind: "config", body: body(1) };
    storage.map.set(PENDING_STORAGE_KEY, JSON.stringify({ kind: "crate-designer.pending-changes", version: 1, items: [good, { id: 5 }] }));
    setPendingStore(localPendingStore(() => storage));
    expect(usePendingChanges.getState().items.map((i) => i.id)).toEqual(["k1"]);
    storage.map.set(PENDING_STORAGE_KEY, "{not json");
    reloadPending();
    expect(usePendingChanges.getState().items).toEqual([]);
  });

  it("writes on top of what another tab stored, never over it", () => {
    const storage = fakeStorage();
    setPendingStore(localPendingStore(() => storage));
    const mine = enqueueConfig({ jobId: JOB, partKey: "catalog:P", partName: "P", body: body(1) });
    // Another tab appends a change straight to storage; this tab hasn't seen it.
    const stored = JSON.parse(storage.map.get(PENDING_STORAGE_KEY)!);
    const theirs = { ...mine, id: "other-tab", body: body(2) };
    storage.map.set(PENDING_STORAGE_KEY, JSON.stringify({ ...stored, items: [...stored.items, theirs] }));
    removeChange(mine.id);
    expect(usePendingChanges.getState().items.map((i) => i.id)).toEqual(["other-tab"]);
  });

  it("gives changes made before the job was known their job, and rebases later job changes", () => {
    const a = enqueueConfig({ jobId: null, partKey: "catalog:P", partName: "P", body: body(1) });
    enqueueConfig({ jobId: null, partKey: "catalog:Q", partName: "Q", body: body(2) });
    assignJob("catalog:P", JOB);
    expect(usePendingChanges.getState().items.map((i) => i.jobId)).toEqual([JOB, null]);
    expect(changesFor(usePendingChanges.getState().items, JOB, "catalog:P").map((c) => c.id)).toEqual([a.id]);

    const p1 = enqueuePatch({ jobId: JOB, partKey: "catalog:P", partName: "P", baseVersion: 3, changes: { notes: "a" } });
    const p2 = enqueuePatch({ jobId: JOB, partKey: "catalog:P", partName: "P", baseVersion: 3, changes: { notes: "b" } });
    removeChange(p1.id);
    rebasePatches(JOB, 3, 4);
    expect(usePendingChanges.getState().items.find((c) => c.id === p2.id)).toMatchObject({ baseVersion: 4 });
  });
});

describe("effectiveJob", () => {
  it("lays the pending changes over the server's job, newest last", () => {
    const items = [
      enqueuePatch({ jobId: JOB, partKey: "k", partName: "P", baseVersion: 1, changes: { select: { configurationId: CONFIG } } }),
      enqueuePatch({ jobId: JOB, partKey: "k", partName: "P", baseVersion: 1, changes: { notes: "mine" } }),
      enqueuePatch({ jobId: JOB, partKey: "k", partName: "P", baseVersion: 1, changes: { select: { inputHash: "h" } } }),
    ];
    expect(effectiveJob(job, items)).toEqual({ selected: { inputHash: "h" }, notes: "mine" });
    expect(effectiveJob(job, [])).toEqual({ selected: null, notes: null });
  });
});
