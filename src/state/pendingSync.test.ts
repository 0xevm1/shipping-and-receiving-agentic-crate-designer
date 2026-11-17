import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { designShipment } from "@/engine/engine";
import type { DesignRequest } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import type { SaveConfigurationRequest } from "@/lib/api/jobs";
import { enqueueConfig, enqueuePatch, memoryPendingStore, setPendingStore, usePendingChanges } from "./pendingChanges";
import { discardChange, flushPending, keepMine, redesign, saveRedesigned, takeTheirs, withSyncLock } from "./pendingSync";

const JOB = "00000000-0000-4000-8000-0000000000aa";
const JOB2 = "00000000-0000-4000-8000-0000000000ab";
const PART = catalog.parts[0]!;
const T = "2026-01-01T00:00:00.000Z";

function saveBody(quantity = 4): SaveConfigurationRequest {
  const request: DesignRequest = {
    part: { id: PART.id, name: PART.name, mass_kg: PART.mass_kg, dimensions_mm: PART.dimensions_mm, material: PART.material },
    settings: { ...DEFAULT_SETTINGS, quantity },
    standards: DEFAULT_STANDARDS,
    layoutKey: null,
    ranking: "volume",
  };
  const out = designShipment(request);
  return JSON.parse(JSON.stringify({ request, engineVersion: out.engineVersion, inputHash: out.inputHash, summary: out.summary }));
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const jobRow = (id: string, version: number, over: Record<string, unknown> = {}) => ({
  id,
  partId: "00000000-0000-4000-8000-0000000000bb",
  status: "open",
  totalQuantity: null,
  selectedConfigurationId: null,
  notes: null,
  version,
  createdAt: T,
  updatedAt: T,
  ...over,
});

/**
 * The server's side of the API in memory: configurations by inputHash, jobs at a version, and
 * `Idempotency-Key` replay of the first response (refusals aren't kept, as on the real server).
 * `engine` is the engine the server runs; `dropResponses` loses the next answers after the
 * server applied them (the request reached it, the reply didn't reach us).
 */
function fakeServer() {
  const s = {
    up: true,
    engine: ENGINE_VERSION,
    dropResponses: 0,
    jobs: new Map([
      [JOB, jobRow(JOB, 1)],
      [JOB2, jobRow(JOB2, 1)],
    ]),
    configs: new Map<string, { id: string; inputHash: string; jobs: Set<string> }>(),
    keys: new Map<string, { status: number; body: unknown }>(),
    requests: [] as { method: string; url: string; key: string | null; body: Record<string, unknown> }[],
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      if (!s.up) throw new TypeError("Failed to fetch");
      const method = init?.method ?? "GET";
      const key = new Headers(init?.headers).get("Idempotency-Key");
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      s.requests.push({ method, url, key, body });
      const answer = (status: number, out: unknown) => {
        if (s.dropResponses > 0) {
          s.dropResponses--;
          throw new TypeError("network dropped the response");
        }
        return json(status, out);
      };
      if (key && s.keys.has(key)) return answer(s.keys.get(key)!.status, s.keys.get(key)!.body);
      const m = /^\/api\/v1\/jobs\/([^/]+)(\/configs)?$/.exec(url);
      const job = m ? s.jobs.get(m[1]!) : undefined;
      if (!m || !job) return json(404, { error: { code: "not_found", message: "No such job." } });
      if (m[2] && method === "POST") {
        if (body.engineVersion !== s.engine) return json(409, { error: { code: "engine_version_mismatch", message: "Reload" }, engineVersion: s.engine });
        if (body.summary?.tampered) return json(422, { error: { code: "result_mismatch", message: "The server got another result." } });
        let c = s.configs.get(body.inputHash);
        if (!c) {
          c = { id: `00000000-0000-4000-8000-${String(s.configs.size + 1).padStart(12, "0")}`, inputHash: body.inputHash, jobs: new Set() };
          s.configs.set(body.inputHash, c);
        }
        const created = !c.jobs.has(job.id);
        c.jobs.add(job.id);
        const configuration = {
          id: c.id,
          inputHash: c.inputHash,
          engineVersion: s.engine,
          quantityPerCrate: 1,
          layout: "auto",
          score: null,
          origin: "user",
          summary: body.summary,
          design: { settings: {}, layoutKey: null, ranking: "volume" },
          createdAt: T,
          addedAt: T,
        };
        const out = { configuration, created };
        if (key) s.keys.set(key, { status: created ? 201 : 200, body: out });
        return answer(created ? 201 : 200, out);
      }
      if (method === "GET") {
        const configurations = [...s.configs.values()].filter((c) => c.jobs.has(job.id)).map((c) => ({ id: c.id, inputHash: c.inputHash }));
        return json(200, { job, configurations, part: {}, artifacts: [], lastEventId: 0, engineVersion: s.engine });
      }
      if (method === "PATCH") {
        if (body.version !== job.version) return json(409, { error: { code: "version_conflict", message: "Changed" }, job });
        if (body.selectedConfigurationId && ![...s.configs.values()].some((c) => c.id === body.selectedConfigurationId && c.jobs.has(job.id))) {
          return json(422, { error: { code: "invalid_request", message: "Not one of the job's configurations." } });
        }
        const { version, ...changes } = body;
        const next = { ...job, ...changes, version: version + 1 };
        s.jobs.set(job.id, next);
        if (key) s.keys.set(key, { status: 200, body: { job: next } });
        return answer(200, { job: next });
      }
      return json(404, { error: { code: "not_found", message: "?" } });
    }),
  };
  return s;
}

/** The snapshot fetch above is partial; flushPending only reads `configurations` from it, through jobApi's schema. Stub that read. */
vi.mock("./jobApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("./jobApi")>();
  return {
    ...real,
    fetchJob: async (jobId: string, opts?: { fetch?: typeof fetch }) => {
      try {
        const res = await opts!.fetch!(`/api/v1/jobs/${jobId}`, { method: "GET" });
        if (!res.ok) return { ok: false, kind: "rejected", status: res.status, code: "not_found", message: "" };
        return { ok: true, status: 200, data: await res.json() };
      } catch {
        return { ok: false, kind: "offline" };
      }
    },
  };
});

let server: ReturnType<typeof fakeServer>;
const api = () => ({ fetch: server.fetch as unknown as typeof fetch });
const items = () => usePendingChanges.getState().items;
const base = { partKey: "catalog:P", partName: "P" };

beforeEach(() => {
  setPendingStore(memoryPendingStore());
  server = fakeServer();
});
afterEach(() => vi.unstubAllGlobals());

describe("flushPending", () => {
  it("sends oldest first, a recommendation after the configuration it names, and clears each on confirmation", async () => {
    const body = saveBody(4);
    enqueueConfig({ ...base, jobId: JOB, body });
    enqueuePatch({ ...base, jobId: JOB, baseVersion: 1, changes: { select: { inputHash: body.inputHash } } });
    enqueuePatch({ ...base, jobId: JOB, baseVersion: 1, changes: { notes: "Ship Tuesday" } });
    const saved: string[] = [];
    const r = await flushPending({ api: api(), onConfigSaved: (_j, c) => saved.push(c.id) });
    expect(r).toEqual({ sent: 3, offline: false, busy: false });
    expect(items()).toEqual([]);
    expect(server.requests.filter((q) => q.method !== "GET").map((q) => `${q.method} ${q.body.version ?? ""}`)).toEqual(["POST ", "PATCH 1", "PATCH 2"]);
    const configId = server.configs.get(body.inputHash)!.id;
    expect(saved).toEqual([configId]);
    // The second job change was made on version 1 too; it went on top of the first one's result.
    expect(server.jobs.get(JOB)).toMatchObject({ version: 3, selectedConfigurationId: configId, notes: "Ship Tuesday" });
  });

  it("sends each change under its own id as the Idempotency-Key, so a lost response replays once", async () => {
    const change = enqueueConfig({ ...base, jobId: JOB, body: saveBody(5) });
    server.dropResponses = 1; // Applied on the server, but the answer is lost.
    const first = await flushPending({ api: api() });
    expect(first.offline).toBe(true);
    expect(items()).toHaveLength(1); // Not confirmed: kept.
    expect(server.configs.size).toBe(1);

    const again = await flushPending({ api: api() });
    expect(again.sent).toBe(1);
    expect(items()).toEqual([]);
    const posts = server.requests.filter((q) => q.method === "POST");
    expect(posts.map((q) => q.key)).toEqual([change.id, change.id]);
    expect(server.configs.size).toBe(1);
    expect([...server.configs.values()][0]!.jobs.size).toBe(1);
  });

  it("stops at the first offline answer and keeps everything", async () => {
    enqueueConfig({ ...base, jobId: JOB, body: saveBody(2) });
    enqueueConfig({ ...base, jobId: JOB, body: saveBody(3) });
    server.up = false;
    const onOffline = vi.fn();
    expect(await flushPending({ api: api(), onOffline })).toEqual({ sent: 0, offline: true, busy: false });
    expect(onOffline).toHaveBeenCalledOnce();
    expect(items()).toHaveLength(2);
    expect(items().every((c) => c.state === "pending")).toBe(true);
  });

  it("waits with changes whose job isn't known yet", async () => {
    enqueueConfig({ ...base, jobId: null, body: saveBody(2) });
    expect((await flushPending({ api: api() })).sent).toBe(0);
    expect(server.requests).toEqual([]);
  });

  it("keeps a conflicting job change (never dropped, never applied), holds back the job's later changes, and lets other jobs through", async () => {
    server.jobs.set(JOB, jobRow(JOB, 7, { notes: "theirs" }));
    const conflicted = enqueuePatch({ ...base, jobId: JOB, baseVersion: 1, changes: { notes: "mine" } });
    const later = enqueueConfig({ ...base, jobId: JOB, body: saveBody(2) });
    enqueueConfig({ ...base, partKey: "catalog:Q", jobId: JOB2, body: saveBody(3) });
    const seen: unknown[] = [];
    const r = await flushPending({ api: api(), onJob: (j) => seen.push(j) });
    expect(r.sent).toBe(1); // JOB2's change.
    expect(items().map((c) => [c.id, c.state])).toEqual([
      [conflicted.id, "conflict"],
      [later.id, "pending"],
    ]);
    expect(items()[0]).toMatchObject({ serverJob: { version: 7, notes: "theirs" } });
    expect(server.jobs.get(JOB)).toMatchObject({ notes: "theirs", version: 7 });
    expect(seen).toMatchObject([{ id: JOB, version: 7 }]);

    // Still blocked on the next run.
    expect((await flushPending({ api: api() })).sent).toBe(0);

    // Keep mine: sent again on the server's version, under a new key.
    keepMine(conflicted.id);
    expect(items()[0]).toMatchObject({ state: "pending", baseVersion: 7 });
    expect(items()[0]!.id).not.toBe(conflicted.id);
    expect((await flushPending({ api: api() })).sent).toBe(2);
    expect(server.jobs.get(JOB)).toMatchObject({ notes: "mine", version: 8 });
  });

  it("take theirs drops the change and hands back the server's job", async () => {
    server.jobs.set(JOB, jobRow(JOB, 3, { notes: "theirs" }));
    const c = enqueuePatch({ ...base, jobId: JOB, baseVersion: 1, changes: { notes: "mine" } });
    await flushPending({ api: api() });
    expect(takeTheirs(c.id)).toMatchObject({ version: 3, notes: "theirs" });
    expect(items()).toEqual([]);
  });

  it("keeps a change the server rejects, with its message, until the user discards it", async () => {
    const body = saveBody(2);
    const c = enqueueConfig({ ...base, jobId: JOB, body: { ...body, summary: { ...body.summary, tampered: true } } });
    await flushPending({ api: api() });
    expect(items()).toMatchObject([{ id: c.id, state: "rejected", message: "The server got another result." }]);
    discardChange(c.id);
    expect(items()).toEqual([]);
  });

  it("an older tab (the server runs a newer engine) stops saving configurations and asks for a reload; they stay queued", async () => {
    server.engine = "9.9.9+engine.99";
    enqueueConfig({ ...base, jobId: JOB, body: saveBody(2) });
    enqueuePatch({ ...base, jobId: JOB2, partKey: "catalog:Q", baseVersion: 1, changes: { notes: "n" } });
    const onReloadNeeded = vi.fn();
    const r = await flushPending({ api: api(), onReloadNeeded });
    expect(onReloadNeeded).toHaveBeenCalledOnce();
    expect(r.sent).toBe(1); // The other job's change.
    expect(items()).toMatchObject([{ kind: "config", state: "pending" }]);
  });

  it("re-stamps a change made by an earlier engine when this engine agrees, and sends it", async () => {
    const body = { ...saveBody(3), engineVersion: "0.0.1+engine.0" };
    enqueueConfig({ ...base, jobId: JOB, body });
    const r = await flushPending({ api: api() });
    expect(r.sent).toBe(1);
    expect(items()).toEqual([]);
    const posts = server.requests.filter((q) => q.method === "POST");
    expect(posts).toHaveLength(2);
    expect((posts[1]!.body as unknown as SaveConfigurationRequest).engineVersion).toBe(ENGINE_VERSION);
    expect(posts[1]!.key).not.toBe(posts[0]!.key);
  });

  it("surfaces a change made by an earlier engine whose result this engine no longer agrees with: kept as stale, never sent as is", async () => {
    const body = saveBody(3);
    const old = { ...body, engineVersion: "0.0.1+engine.0", summary: { ...body.summary, totals: { ...(body.summary.totals as object), costUsd: 1 } } };
    const c = enqueueConfig({ ...base, jobId: JOB, body: old });
    enqueuePatch({ ...base, jobId: JOB, baseVersion: 1, changes: { notes: "after it" } });
    await flushPending({ api: api() });
    expect(items()).toMatchObject([
      { id: c.id, state: "stale", redesigned: { engineVersion: ENGINE_VERSION, inputHash: body.inputHash } },
      { kind: "patch", state: "pending" },
    ]);
    expect(server.configs.size).toBe(0);
    expect(server.jobs.get(JOB)!.notes).toBeNull(); // Held back behind it.

    saveRedesigned(c.id);
    expect((await flushPending({ api: api() })).sent).toBe(2);
    expect(server.configs.has(body.inputHash)).toBe(true);
  });
});

describe("redesign", () => {
  it("says whether the running engine gives the same result, and gives up on a request it can't read", () => {
    const body = saveBody(2);
    expect(redesign(body)).toMatchObject({ same: true, body: { inputHash: body.inputHash } });
    expect(redesign({ ...body, summary: { other: 1 } })?.same).toBe(false);
    expect(redesign({ ...body, request: { nope: true } })).toBeNull();
  });
});

describe("withSyncLock", () => {
  it("runs alone across tabs with Web Locks, and skips when another tab holds the lock", async () => {
    let held = false;
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, _opts: unknown, cb: (lock: object | null) => Promise<void>) => {
          if (held) return cb(null);
          held = true;
          try {
            await cb({});
          } finally {
            held = false;
          }
        },
      },
    });
    let release!: () => void;
    const first = withSyncLock(() => new Promise<void>((r) => (release = r)));
    const second = vi.fn(async () => {});
    expect(await withSyncLock(second)).toBe(false);
    expect(second).not.toHaveBeenCalled();
    release();
    expect(await first).toBe(true);
    expect(await withSyncLock(second)).toBe(true);
  });

  it("just runs where there is no Web Locks API (the idempotency keys keep a double send harmless)", async () => {
    vi.stubGlobal("navigator", {});
    const fn = vi.fn(async () => {});
    expect(await withSyncLock(fn)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });
});
