import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigurationResponse, JobResponse } from "@/lib/api/jobs";
import { cachedJob, cacheJob, JOB_CACHE_STORAGE_KEY, MAX_CACHED_JOBS, updateCachedJob } from "./jobCache";

const T = "2026-01-01T00:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n: number, version = 1): JobResponse => ({
  id: uuid(n),
  partId: uuid(900),
  status: "open",
  totalQuantity: null,
  selectedConfigurationId: null,
  notes: null,
  version,
  createdAt: T,
  updatedAt: T,
});
const config = (n: number, pad = ""): ConfigurationResponse => ({
  id: uuid(500 + n),
  inputHash: `h${n}`,
  engineVersion: "e",
  quantityPerCrate: 2,
  layout: "auto",
  score: 1,
  origin: "user",
  summary: { pad },
  design: { settings: {}, layoutKey: null, ranking: "volume" },
  createdAt: T,
  addedAt: T,
});

function storage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("the job cache", () => {
  it("keeps the last-opened jobs by part, newest first, at most MAX_CACHED_JOBS", () => {
    const s = storage();
    for (let i = 1; i <= MAX_CACHED_JOBS + 2; i++) cacheJob(`catalog:P${i}`, { job: job(i), configurations: [config(i)] }, s);
    expect(cachedJob("catalog:P1", s)).toBeNull();
    expect(cachedJob(`catalog:P${MAX_CACHED_JOBS + 2}`, s)).toMatchObject({
      job: { id: uuid(MAX_CACHED_JOBS + 2) },
      configurations: [{ inputHash: `h${MAX_CACHED_JOBS + 2}` }],
    });
    expect(JSON.parse(s.map.get(JOB_CACHE_STORAGE_KEY)!).entries).toHaveLength(MAX_CACHED_JOBS);
  });

  it("drops the oldest jobs when the cache would grow past its size", () => {
    const s = storage();
    const big = "x".repeat(400_000);
    cacheJob("a", { job: job(1), configurations: [config(1, big)] }, s);
    cacheJob("b", { job: job(2), configurations: [config(2, big)] }, s);
    cacheJob("c", { job: job(3), configurations: [config(3, big)] }, s);
    expect(cachedJob("a", s)).toBeNull();
    expect(cachedJob("c", s)).not.toBeNull();
  });

  it("adds a configuration and a newer job row in place, never an older one", () => {
    const s = storage();
    cacheJob("a", { job: job(1, 2), configurations: [] }, s);
    updateCachedJob(uuid(1), { configuration: config(7) }, s);
    updateCachedJob(uuid(1), { job: { ...job(1, 1), notes: "older" } }, s);
    expect(cachedJob("a", s)).toMatchObject({ job: { version: 2, notes: null }, configurations: [{ inputHash: "h7" }] });
    updateCachedJob(uuid(1), { job: { ...job(1, 3), notes: "newer" } }, s);
    expect(cachedJob("a", s)?.job.notes).toBe("newer");
    expect(updateCachedJob(uuid(99), { job: job(99) }, s)).toBe(false);
  });

  it("never throws when storage does, or holds something else", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(cacheJob("a", { job: job(1), configurations: [] }, broken)).toBe(false);
    expect(cachedJob("a", broken)).toBeNull();
    expect(cachedJob("a", null)).toBeNull();
    const s = storage();
    s.map.set(JOB_CACHE_STORAGE_KEY, "nope");
    expect(cachedJob("a", s)).toBeNull();
  });
});
