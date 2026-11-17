import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPart } from "@/domain/catalog";
import { designShipment, inputHash } from "@/engine/engine";
import { DesignRequestSchema } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import type { ConfigurationResponse, JobSnapshot } from "@/lib/api/jobs";
import { catalogPart } from "@/lib/part";
import { configurationBody, partIdentity, saveConfiguration, selectConfiguration, startJobSync, useJobSync } from "./jobSync";
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
  FakeEventSource.instances = [];
});
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
  it("names a catalog part by its id and a loaded model by its URL", () => {
    expect(partIdentity(catalogPart(getPart("PART-001")))).toEqual({ key: "catalog:PART-001", catalogId: "PART-001" });
    const custom = { ...catalogPart(getPart("PART-001")), catalogDims: undefined, id: "x", modelUrl: "blob:1" };
    expect(partIdentity(custom)).toEqual({ key: "model:blob:1" });
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

describe("selectConfiguration", () => {
  it("takes the server's job on a version conflict", async () => {
    useJobSync.setState({ job: { ...job } });
    const newer = { ...job, version: 5, notes: "theirs" };
    const fetch = vi.fn(async () => json(409, { error: { code: "version_conflict", message: "Changed" }, job: newer }));
    expect(await selectConfiguration(CONFIG, { fetch })).toEqual({ kind: "conflict" });
    expect(useJobSync.getState().job).toEqual(newer);
  });
});

describe("startJobSync", () => {
  it("opens the catalog part's job, reads its snapshot, subscribes from lastEventId, and refreshes on config.added", async () => {
    const saved = configResponse();
    let snapshots = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/jobs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ catalogId: useDesigner.getState().part.id, reuse: true });
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

  it("goes offline without throwing when the server can't be reached, and tries again", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      const stop = startJobSync({ api: { fetch }, EventSourceImpl: FakeEventSource as unknown as typeof EventSource, retryMs: 1000 });
      await vi.waitFor(() => expect(useJobSync.getState().status).toBe("offline"));
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetch).toHaveBeenCalledTimes(2);
      stop();
      expect(FakeEventSource.instances).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
