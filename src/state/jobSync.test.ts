import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPart } from "@/domain/catalog";
import { designShipment, inputHash } from "@/engine/engine";
import { DesignRequestSchema } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import type { ConfigurationResponse, JobResponse, JobSnapshot, TotalPlanResponse } from "@/lib/api/jobs";
import { catalogPart, framePart } from "@/lib/part";
import { LIVENESS_MAX_DELAY_MS, LIVENESS_MIN_DELAY_MS } from "@/lib/liveness";
import { FACE_IDS, type PartProfile } from "@/domain/profile";
import { designPartHash } from "@/engine/request";
import {
  configurationBody,
  designPartBody,
  keepMyChange,
  partIdentity,
  saveConfiguration,
  saveCurrentDesign,
  selectConfiguration,
  startJobSync,
  takeServerChange,
  updateJob,
  useJobSync,
} from "./jobSync";
import { cacheJob } from "./jobCache";
import { changesFor, effectiveJob, memoryPendingStore, setPendingStore, usePendingChanges } from "./pendingChanges";
import { useDesigner } from "./store";

const JOB = "00000000-0000-4000-8000-0000000000aa";
const PART_ID = "00000000-0000-4000-8000-0000000000bb";
const CONFIG = "00000000-0000-4000-8000-0000000000cc";
const T = "2026-01-01T00:00:00.000Z";

const job = {
  id: JOB,
  partId: PART_ID,
  status: "open",
  totalQuantity: null,
  selectedConfigurationId: null,
  notes: null,
  version: 1,
  createdAt: T,
  updatedAt: T,
} as const;
const part = {
  id: PART_ID,
  name: "Bracket",
  material: null,
  densityKgM3: null,
  massKg: 2,
  sizeMm: [1, 2, 3],
  modelSha256: null,
  source: "catalog",
  catalogId: "PART-001",
  createdAt: T,
};

function configResponse(body = configurationBody(useDesigner.getState()), id = CONFIG): ConfigurationResponse {
  const req = body.request as { settings: Record<string, unknown>; layoutKey: string | null; ranking: string };
  return {
    id,
    inputHash: body.inputHash,
    engineVersion: body.engineVersion,
    quantityPerCrate: 4,
    layout: "auto",
    score: 12.5,
    origin: "user",
    summary: body.summary,
    design: { settings: req.settings, layoutKey: req.layoutKey, ranking: req.ranking },
    createdAt: T,
    addedAt: T,
  };
}

const snapshot = (configurations: ConfigurationResponse[] = [], over: Partial<JobSnapshot> = {}): JobSnapshot => ({
  job,
  part: part as JobSnapshot["part"],
  configurations,
  artifacts: [],
  totalPlan: null,
  lastEventId: 41,
  engineVersion: ENGINE_VERSION,
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = 2;
  }
  emit(id: number, type: string, payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ id, jobId: JOB, type, payload, createdAt: T }) } as MessageEvent<string>);
  }
}

const initialDesigner = useDesigner.getState();
const initialSync = useJobSync.getState();

beforeEach(() => {
  useDesigner.setState(initialDesigner, true);
  useJobSync.setState(initialSync, true);
  setPendingStore(memoryPendingStore());
  FakeEventSource.instances = [];
});

/**
 * A server in memory, enough for the sync: one job for the catalog part, configurations by
 * inputHash, PATCH at a version, `Idempotency-Key` replays, and a health check. `up = false`
 * makes every request fail as a dropped network would.
 */
function fakeServer() {
  const s = {
    up: true,
    job: { ...job } as JobResponse,
    totalPlan: null as TotalPlanResponse | null,
    configs: new Map<string, ConfigurationResponse>(),
    keys: new Map<string, { status: number; body: unknown }>(),
    saveDirect(c: ConfigurationResponse) {
      s.configs.set(c.inputHash, c);
    },
    fetch: (async (url: string, init?: RequestInit) => {
      if (!s.up) throw new TypeError("Failed to fetch");
      const method = init?.method ?? "GET";
      const key = new Headers(init?.headers).get("Idempotency-Key");
      if (key && s.keys.has(key)) {
        const seen = s.keys.get(key)!;
        return json(seen.status, seen.body);
      }
      const remember = (status: number, body: unknown) => {
        if (key && status < 400) s.keys.set(key, { status, body });
        return json(status, body);
      };
      if (url === "/api/v1/health") return json(200, { ok: true });
      if (url === "/api/v1/jobs" && method === "POST") return json(200, { job: s.job, created: false });
      if (url === `/api/v1/jobs/${JOB}` && method === "GET") return json(200, snapshot([...s.configs.values()], { job: s.job, totalPlan: s.totalPlan }));
      if (url === `/api/v1/jobs/${JOB}/configs` && method === "POST") {
        const body = JSON.parse(String(init!.body));
        const existing = s.configs.get(body.inputHash);
        const c = existing ?? configResponse(body, `00000000-0000-4000-8000-${String(s.configs.size + 1).padStart(12, "0")}`);
        s.configs.set(c.inputHash, c);
        return remember(existing ? 200 : 201, { configuration: c, created: !existing });
      }
      if (url === `/api/v1/jobs/${JOB}` && method === "PATCH") {
        const body = JSON.parse(String(init!.body));
        if (body.version !== s.job.version) return json(409, { error: { code: "version_conflict", message: "Changed" }, job: s.job });
        const { version, ...changes } = body;
        s.job = { ...s.job, ...changes, version: version + 1 };
        return remember(200, { job: s.job });
      }
      return json(404, { error: { code: "not_found", message: "?" } });
    }) as unknown as typeof globalThis.fetch,
  };
  return s;
}
afterEach(() => vi.unstubAllGlobals());

describe("configurationBody", () => {
  it("is exactly what the engine designs from and answers, so the server's recompute agrees", () => {
    useDesigner.getState().setSettings({ quantity: 6 });
    const body = configurationBody(useDesigner.getState());
    const request = DesignRequestSchema.parse(body.request);
    expect(body.inputHash).toBe(inputHash(request));
    expect(body.engineVersion).toBe(ENGINE_VERSION);
    expect(JSON.parse(JSON.stringify(designShipment(request).summary))).toEqual(body.summary);
    // Only the part's design fields travel: not the model URL or load facts.
    expect(Object.keys(body.request.part as object)).not.toContain("modelUrl");
  });
});

describe("partIdentity", () => {
  it("names a catalog part by its id and a loaded model by its URL and how it is read", () => {
    expect(partIdentity(catalogPart(getPart("PART-001")))).toEqual({ key: "catalog:PART-001", catalogId: "PART-001" });
    const custom = { ...catalogPart(getPart("PART-001")), catalogDims: undefined, id: "x", modelUrl: "blob:1" };
    expect(partIdentity(custom)).toEqual({ key: "model:blob:1:m-z" });
    // The same file read in inches, Y up, is another part to the server (#105).
    expect(partIdentity(framePart(custom, { units: "in", up: "y" }))).toEqual({ key: "model:blob:1:in-y" });
  });
});

describe("saveConfiguration", () => {
  it("adds the saved configuration to the job's list", async () => {
    useJobSync.setState({ job: { ...job } });
    const body = configurationBody(useDesigner.getState());
    const fetch = vi.fn(async () => json(201, { configuration: configResponse(body), created: true }));
    const r = await saveConfiguration(JOB, body, { fetch, idempotencyKey: "change-1" });
    expect(r).toMatchObject({ kind: "saved", created: true, config: { id: CONFIG, inputHash: body.inputHash } });
    expect(useJobSync.getState().configs.map((c) => c.id)).toEqual([CONFIG]);
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("change-1");
  });

  it("asks for a reload on an engine mismatch, and resolves quietly when offline", async () => {
    const body = configurationBody(useDesigner.getState());
    const engine = vi.fn(async () => json(409, { error: { code: "engine_version_mismatch", message: "Reload" }, engineVersion: "2" }));
    expect(await saveConfiguration(JOB, body, { fetch: engine })).toEqual({ kind: "reload" });
    expect(useJobSync.getState().reloadNeeded).toBe(true);
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await saveConfiguration(JOB, body, { fetch: down })).toEqual({ kind: "offline" });
  });
});

describe("startJobSync", () => {
  it("opens the catalog part's job, reads its snapshot, subscribes from lastEventId, and refreshes on config.added", async () => {
    const saved = configResponse();
    let snapshots = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/jobs" && init?.method === "POST") {
        // The part as this browser designs it goes with the job (#46 "same inputs").
        expect(JSON.parse(String(init.body))).toEqual({
          catalogId: useDesigner.getState().part.id,
          reuse: true,
          designPart: designPartBody(useDesigner.getState().part),
        });
        return json(200, { job, created: false });
      }
      if (url === `/api/v1/jobs/${JOB}`) return json(200, snapshot(snapshots++ ? [saved] : []));
      return json(404, { error: { code: "not_found", message: "?" } });
    });
    const stop = startJobSync({
      api: { fetch: fetch as unknown as typeof globalThis.fetch },
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      refreshDelayMs: 0,
    });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toBe(`/api/v1/events?job=${JOB}&lastEventId=41`);
    es.onopen?.();
    expect(useJobSync.getState()).toMatchObject({ status: "live", job: { id: JOB }, configs: [] });

    // Another tab saved: the list follows.
    es.emit(42, "config.added", { configurationId: CONFIG, inputHash: saved.inputHash });
    await vi.waitFor(() => expect(useJobSync.getState().configs.map((c) => c.id)).toEqual([CONFIG]));

    // A newer engine on the server asks for a reload.
    es.emit(43, "engine.updated", { engineVersion: "9.9.9+engine.9" });
    expect(useJobSync.getState().reloadNeeded).toBe(true);
    stop();
    expect(es.readyState).toBe(2);
  });

  it('sends the part to its job once its outline is measured, once per version (#46 "same inputs")', async () => {
    const puts: Record<string, unknown>[] = [];
    let partHash: string | null = null;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/jobs" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        partHash = designPartHash(body.designPart);
        return json(201, { job: { ...job, partHash }, created: true });
      }
      if (url === `/api/v1/jobs/${JOB}/part` && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body.part);
        partHash = designPartHash(body.part);
        return json(200, { job: { ...job, partHash }, changed: true });
      }
      if (url === `/api/v1/jobs/${JOB}`) return json(200, { ...snapshot([]), job: { ...job, partHash } });
      return json(404, { error: { code: "not_found", message: "?" } });
    });
    const stop = startJobSync({
      api: { fetch: fetch as unknown as typeof globalThis.fetch },
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      refreshDelayMs: 0,
      partSyncDelayMs: 0,
    });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    // The job already has this part (no outline yet): nothing more is sent.
    await new Promise((r) => setTimeout(r, 20));
    expect(puts).toEqual([]);

    const { part } = useDesigner.getState();
    const face = { cols: 1, rows: 1, depth: [0] };
    const profile: PartProfile = {
      version: 1,
      sizeMm: part.dimensions_mm,
      cellMm: 2,
      faces: Object.fromEntries(FACE_IDS.map((f) => [f, face])) as PartProfile["faces"],
    };
    useDesigner.getState().setPartProfile(part.modelUrl, profile);
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual(designPartBody(useDesigner.getState().part));
    expect(puts[0]!.profile).toEqual(profile);
    await vi.waitFor(() => expect(useJobSync.getState().job?.partHash).toBe(designPartHash(puts[0] as never)));
    // Another change to the store that leaves the part as it is sends nothing.
    useDesigner.getState().setSettings({ quantity: 3 });
    await new Promise((r) => setTimeout(r, 20));
    expect(puts).toHaveLength(1);
    stop();
  });

  it("on engine.updated, ignores its own engine version and asks for a reload on another before saving again", async () => {
    let snapshots = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/jobs" && init?.method === "POST") return json(200, { job, created: false });
      if (url === `/api/v1/jobs/${JOB}`) return (snapshots++, json(200, snapshot([])));
      return json(404, { error: { code: "not_found", message: "?" } });
    });
    const stop = startJobSync({
      api: { fetch: fetch as unknown as typeof globalThis.fetch },
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      refreshDelayMs: 0,
    });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    es.onopen?.();
    const reads = snapshots;

    // Another instance started on the engine this tab already runs: nothing to do, not even a re-read.
    es.emit(43, "engine.updated", { engineVersion: ENGINE_VERSION });
    await new Promise((r) => setTimeout(r, 10));
    expect(useJobSync.getState().reloadNeeded).toBe(false);
    expect(snapshots).toBe(reads);

    // A new engine: the reload prompt, and saving waits for the reload rather than going out.
    es.emit(44, "engine.updated", { engineVersion: `${ENGINE_VERSION}.next` });
    expect(useJobSync.getState().reloadNeeded).toBe(true);
    const sent = fetch.mock.calls.length;
    useDesigner.getState().setSettings({ quantity: 3 });
    expect(saveCurrentDesign().kind).toBe("reload");
    expect(fetch.mock.calls.length).toBe(sent);
    stop();
  });

  it("goes offline without throwing when the server can't be reached, and probes its health until it answers", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async (url: string) => {
        void url;
        throw new TypeError("Failed to fetch");
      });
      const stop = startJobSync({
        api: { fetch: fetch as unknown as typeof globalThis.fetch },
        EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      });
      await vi.waitFor(() => expect(useJobSync.getState().status).toBe("offline"));
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(LIVENESS_MIN_DELAY_MS);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1]![0]).toBe("/api/v1/health");
      stop();
      expect(FakeEventSource.instances).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves offline on this device, then syncs by itself within 5 s of the server coming back", async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer();
      server.up = false;
      const stop = startJobSync({ api: { fetch: server.fetch }, EventSourceImpl: FakeEventSource as unknown as typeof EventSource, refreshDelayMs: 0 });
      await vi.waitFor(() => expect(useJobSync.getState().status).toBe("offline"));

      useDesigner.getState().setSettings({ quantity: 3 });
      const r = saveCurrentDesign();
      expect(r.kind).toBe("queued");
      // Kept on this device, marked unsynced, and nothing reached the server.
      expect(usePendingChanges.getState().items).toMatchObject([
        { kind: "config", state: "pending", jobId: null, partKey: `catalog:${useDesigner.getState().part.id}` },
      ]);
      expect(server.configs.size).toBe(0);
      // A second save of the same design is the same change.
      expect(saveCurrentDesign().kind).toBe("duplicate");

      // Long offline: the probe backs off but never waits more than the cap.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(server.configs.size).toBe(0);
      server.up = true;
      const back = Date.now();
      await vi.advanceTimersByTimeAsync(LIVENESS_MAX_DELAY_MS + 100);
      expect(usePendingChanges.getState().items).toEqual([]);
      expect(Date.now() - back).toBeLessThan(5000);
      expect(server.configs.size).toBe(1);
      expect(useJobSync.getState().configs.map((c) => c.inputHash)).toEqual([configurationBody(useDesigner.getState()).inputHash]);
      // The change carried its id as the idempotency key.
      expect(server.keys.size).toBe(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a job kept on this device with the server stopped, and queues saves against it", async () => {
    vi.useFakeTimers();
    const map = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    vi.stubGlobal("window", { localStorage, addEventListener: () => {}, removeEventListener: () => {} });
    try {
      const partKey = `catalog:${useDesigner.getState().part.id}`;
      const kept = configResponse();
      cacheJob(partKey, { job: { ...job, notes: "kept" }, configurations: [kept] });
      const server = fakeServer();
      server.up = false;
      const stop = startJobSync({ api: { fetch: server.fetch }, EventSourceImpl: FakeEventSource as unknown as typeof EventSource, refreshDelayMs: 0 });
      await vi.waitFor(() => expect(useJobSync.getState().status).toBe("offline"));
      expect(useJobSync.getState()).toMatchObject({ fromCache: true, job: { id: JOB, notes: "kept" }, configs: [{ id: CONFIG }] });

      useDesigner.getState().setSettings({ quantity: 2 });
      expect(saveCurrentDesign().kind).toBe("queued");
      expect(updateJob({ notes: "offline note" }).kind).toBe("queued");
      expect(usePendingChanges.getState().items.map((c) => c.jobId)).toEqual([JOB, JOB]);

      server.up = true;
      await vi.advanceTimersByTimeAsync(LIVENESS_MAX_DELAY_MS + 100);
      expect(usePendingChanges.getState().items).toEqual([]);
      expect(server.job.notes).toBe("offline note");
      expect(useJobSync.getState().fromCache).toBe(false);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes the total offline on a kept job, sends it once when the server is back, and takes the server's plan from the next snapshot", async () => {
    vi.useFakeTimers();
    const map = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    vi.stubGlobal("window", { localStorage, addEventListener: () => {}, removeEventListener: () => {} });
    try {
      const partKey = `catalog:${useDesigner.getState().part.id}`;
      cacheJob(partKey, { job, configurations: [] });
      const server = fakeServer();
      server.up = false;
      const stop = startJobSync({ api: { fetch: server.fetch }, EventSourceImpl: FakeEventSource as unknown as typeof EventSource, refreshDelayMs: 0 });
      await vi.waitFor(() => expect(useJobSync.getState().status).toBe("offline"));

      expect(updateJob({ totalQuantity: 40 }).kind).toBe("queued");
      const mine = () => changesFor(usePendingChanges.getState().items, JOB, partKey);
      // The total is in effect on this device at once (the browser plans it), marked unsynced.
      expect(effectiveJob(useJobSync.getState().job, mine()).totalQuantity).toBe(40);
      expect(mine()).toMatchObject([{ kind: "patch", state: "pending", changes: { totalQuantity: 40 } }]);
      expect(server.job.totalQuantity).toBeNull();

      server.up = true;
      await vi.advanceTimersByTimeAsync(LIVENESS_MAX_DELAY_MS + 100);
      expect(usePendingChanges.getState().items).toEqual([]);
      expect(server.job).toMatchObject({ totalQuantity: 40, version: 2 });
      // Applied once: one PATCH, under the change's idempotency key.
      expect(server.keys.size).toBe(1);
      expect(useJobSync.getState().job).toMatchObject({ totalQuantity: 40 });
      expect(useJobSync.getState().totalPlan).toBeNull();

      // The server's sweep planned it: configs.ready, and the snapshot carries the plan.
      const plan: TotalPlanResponse = {
        total: 40,
        engineVersion: ENGINE_VERSION,
        inputHash: "a".repeat(64),
        basis: "crate-only",
        computedAt: T,
        plan: {
          crates: 2,
          perCrate: 20,
          types: [{ label: "A", count: 2, quantity: 20, layoutKey: "k", configurationId: CONFIG }],
          crateCostUsd: 800,
          freightUsd: null,
          scoreUsdPerPart: 20,
        },
        rationale: ["40 parts ship as 2 crates × 20."],
      };
      server.totalPlan = plan;
      await vi.waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      FakeEventSource.instances.at(-1)!.emit(50, "configs.ready", { count: 1, totalPlan: { total: 40, crates: 2, perCrate: 20, scoreUsdPerPart: 20 } });
      await vi.advanceTimersByTimeAsync(10);
      expect(useJobSync.getState().totalPlan).toEqual(plan);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a recommendation that conflicts, then sends it again on the server's version when the user keeps theirs", async () => {
    const server = fakeServer();
    const stop = startJobSync({ api: { fetch: server.fetch }, EventSourceImpl: FakeEventSource as unknown as typeof EventSource, refreshDelayMs: 0 });
    await vi.waitFor(() => expect(useJobSync.getState().job?.id).toBe(JOB));
    server.saveDirect(configResponse());
    // Someone else changes the job; this tab still has version 1.
    server.job = { ...server.job, version: 2, notes: "theirs" };

    expect(selectConfiguration({ configurationId: CONFIG }).kind).toBe("queued");
    await vi.waitFor(() => expect(usePendingChanges.getState().items[0]?.state).toBe("conflict"));
    const change = usePendingChanges.getState().items[0]!;
    expect(change).toMatchObject({ kind: "patch", serverJob: { version: 2, notes: "theirs" } });
    // The tab now shows the server's job; the change waits for the user.
    expect(useJobSync.getState().job).toMatchObject({ version: 2, notes: "theirs" });

    keepMyChange(change.id);
    await vi.waitFor(() => expect(usePendingChanges.getState().items).toEqual([]));
    expect(server.job).toMatchObject({ version: 3, selectedConfigurationId: CONFIG, notes: "theirs" });
    expect(useJobSync.getState().job).toMatchObject({ version: 3, selectedConfigurationId: CONFIG });
    stop();
  });

  it("drops a conflicting change when the user takes the server's job", async () => {
    const server = fakeServer();
    const stop = startJobSync({ api: { fetch: server.fetch }, EventSourceImpl: FakeEventSource as unknown as typeof EventSource, refreshDelayMs: 0 });
    await vi.waitFor(() => expect(useJobSync.getState().job?.id).toBe(JOB));
    server.job = { ...server.job, version: 4, notes: "theirs" };
    updateJob({ notes: "mine" });
    await vi.waitFor(() => expect(usePendingChanges.getState().items[0]?.state).toBe("conflict"));
    takeServerChange(usePendingChanges.getState().items[0]!.id);
    expect(usePendingChanges.getState().items).toEqual([]);
    expect(useJobSync.getState().job).toMatchObject({ version: 4, notes: "theirs" });
    expect(server.job.notes).toBe("theirs");
    stop();
  });
});
