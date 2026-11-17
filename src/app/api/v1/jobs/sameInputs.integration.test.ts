// Browser and server design from the same inputs (#46 "same inputs", docs/API.md "The job's part"):
// the browser sends its part, measured outline included, with the job; the queue's sweep designs
// from it through the engine's one request builder, so the server's stored recommendation,
// shortlist and total plan equal what the browser's store and sweeper compute for the same part.
// Against a scratch Postgres database and the engine's real worker threads.
// `bun run test:integration` (after `bun run infra:up`).
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { catalog, getPart } from "@/domain/catalog";
import type { PartProfile } from "@/domain/profile";
import type { QuantitySweep } from "@/domain/sweep";
import { designPartHash } from "@/engine/request";
import { CreateJobResponseSchema, JobSnapshotSchema, PutJobPartResponseSchema } from "@/lib/api/jobs";
import { catalogPart, type LoadedPart } from "@/lib/part";
import { buildPartProfile } from "@/lib/partProfile";
import { closeDb, DEFAULT_ORG } from "@/server/db";
import { createQueueStore } from "@/server/db/queue";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { peekEventBus } from "@/server/events";
import { createJobHandlers, sweepDedupeKey } from "@/server/queue/jobs";
import { createQueueRunner } from "@/server/queue/runner";
import { closeEnginePool, getEnginePool } from "@/server/workers/engine";
import { startSweeps, useSweep } from "@/state/bestQuantity";
import { createEngineClient } from "@/state/engineClient";
import { designPartBody } from "@/state/jobSync";
import { useDesigner } from "@/state/store";
import { totalPlanView } from "@/state/totalPlan";
import { PUT as putPart } from "./[id]/part/route";
import { GET } from "./[id]/route";
import { POST as createJob } from "./route";

const BASE = "http://localhost/api/v1";
const TOTAL = 60;
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

let t: TestDatabase;
const saved = { DATABASE_URL: process.env.DATABASE_URL };
const profiles = new Map<string, PartProfile>();

beforeAll(async () => {
  t = await createTestDatabase("same_inputs");
  process.env.DATABASE_URL = t.url;
  // Each sample part's outline, measured as the browser's viewer measures it (spec §7.5b).
  for (const p of catalog.parts) {
    const b = readFileSync(`public/parts/${p.model}`);
    const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "");
    profiles.set(p.id, buildPartProfile(gltf.scene, 1000, 60_000));
  }
});
afterAll(async () => {
  await peekEventBus()?.stop();
  (globalThis as { __crateDesignerEventBus?: unknown }).__crateDesignerEventBus = undefined;
  await closeEnginePool();
  await closeDb();
  Object.assign(process.env, saved);
  await t?.drop();
});

const json = (method: string, path: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function snapshot(id: string) {
  const res = await GET(new Request(`${BASE}/jobs/${id}`), params(id));
  expect(res.status).toBe(200);
  return JobSnapshotSchema.parse(await res.json());
}

async function open(body: Record<string, unknown>) {
  const res = await createJob(json("POST", "/jobs", body));
  expect(res.status).toBeLessThan(300);
  return CreateJobResponseSchema.parse(await res.json()).job;
}

async function put(id: string, part: unknown) {
  const res = await putPart(json("PUT", `/jobs/${id}/part`, { part }), params(id));
  expect(res.status).toBe(200);
  return PutJobPartResponseSchema.parse(await res.json());
}

/** Runs the queue until it is empty, as `bun run worker` would, on the engine's worker threads. */
async function drain() {
  const runner = createQueueRunner({ store: createQueueStore(t.db), handlers: createJobHandlers({ db: t.db, pool: getEnginePool() }), log: quiet });
  while (await runner.runOnce()) {
    // one job at a time
  }
}

const pendingSweeps = (jobId: string) =>
  t.sql<{ dedupe_key: string }[]>`select dedupe_key from queue_job where kind = 'sweep' and status in ('queued', 'running') and payload->>'jobId' = ${jobId}`;

/**
 * The browser's sweep for `part`, the way the page makes it: the part on the designer's store (its
 * outline set as the viewer sets it), swept by `startSweeps` (the same request builder and engine
 * call as the page's Web Worker; here in this thread).
 */
async function browserSweep(part: LoadedPart, profile: PartProfile | null): Promise<{ sweep: QuantitySweep; part: LoadedPart }> {
  useDesigner.getState().setPart(part);
  if (profile) useDesigner.getState().setPartProfile(part.modelUrl, profile);
  const stop = startSweeps(
    createEngineClient(() => null),
    0,
  );
  await vi.waitFor(() => expect(useSweep.getState().done?.inputs.part).toBe(useDesigner.getState().part));
  stop();
  return { sweep: useSweep.getState().done!.sweep, part: useDesigner.getState().part };
}

/** The server's stored answer agrees with the browser's: recommendation, shortlist and total plan. */
async function expectSameAnswer(jobId: string, sweep: QuantitySweep) {
  const snap = await snapshot(jobId);
  const rec = sweep.recommendation!;
  const selected = snap.configurations.find((c) => c.id === snap.job.selectedConfigurationId)!;
  expect(selected).toMatchObject({ origin: "precomputed", quantityPerCrate: rec.quantity, layout: rec.crate.layoutKey });
  expect(selected.score).toBeCloseTo(rec.crate.scoreUsdPerPart, 9);
  // Every shortlisted quantity is one of the job's configurations, at the browser's layout and cost per part.
  const precomputed = snap.configurations.filter((c) => c.origin === "precomputed");
  for (const p of sweep.shortlist) {
    const c = precomputed.find((x) => x.quantityPerCrate === p.quantity && x.layout === p.crate!.layoutKey);
    expect(c, `${p.quantity} per crate`).toBeDefined();
    expect(c!.score).toBeCloseTo(p.crate!.scoreUsdPerPart, 9);
  }
  // The total plan: the shared job card shows one plan, the browser's and the server's.
  const view = totalPlanView({ total: TOTAL, sweep, server: snap.totalPlan });
  expect(view.shown?.source).toBe("both");
  expect(view.other).toBeNull();
  return { snap, view };
}

describe('browser and server sweep the same part (#46 "same inputs")', () => {
  for (const id of catalog.parts.map((p) => p.id)) {
    it(`${id} with its measured outline: the server's recommendation, shortlist and total plan are the browser's`, async () => {
      const { sweep, part } = await browserSweep(catalogPart(getPart(id)), profiles.get(id)!);
      expect(part.profile).toBeDefined();
      const job = await open({ catalogId: id, totalQuantity: TOTAL, designPart: designPartBody(part) });
      expect(job.partHash).toBe(designPartHash(part));
      await drain();
      const { snap, view } = await expectSameAnswer(job.id, sweep);
      expect(snap.totalPlan!.plan!.scoreUsdPerPart).toBeCloseTo(view.shown!.scoreUsdPerPart!, 9);
      // Both recommend among the part's suggested quantities (#133), not the cheapest of all 200.
      expect(part.suggested_quantities).toContain(sweep.recommendation!.quantity);
      expect(snap.configurations.find((c) => c.id === snap.job.selectedConfigurationId)!.quantityPerCrate).toBe(sweep.recommendation!.quantity);
    });
  }

  it("a part with its own suggested quantities (2 and 6): the server recommends among them, as the browser does", async () => {
    const { sweep, part } = await browserSweep({ ...catalogPart(getPart("PART-001")), suggested_quantities: [2, 6] }, null);
    expect(sweep.candidates).toEqual([2, 6]);
    expect([2, 6]).toContain(sweep.recommendation!.quantity);
    const job = await open({ catalogId: "PART-001", totalQuantity: TOTAL, designPart: designPartBody(part) });
    await drain();
    const { snap } = await expectSameAnswer(job.id, sweep);
    expect(
      snap.configurations
        .filter((c) => c.origin === "precomputed")
        .map((c) => c.quantityPerCrate)
        .sort(),
    ).toContain(sweep.recommendation!.quantity);
    // The total plan still splits by the full curve: 60 parts are not shipped as crates of 2 or 6.
    expect(snap.totalPlan!.plan!.perCrate).toBeGreaterThan(6);
  });
});

describe("PUT /jobs/:id/part", () => {
  let jobId: string;
  let bare: { sweep: QuantitySweep; part: LoadedPart };
  let measured: { sweep: QuantitySweep; part: LoadedPart };

  beforeAll(async () => {
    bare = await browserSweep(catalogPart(getPart("PART-001")), null);
    measured = await browserSweep(catalogPart(getPart("PART-001")), profiles.get("PART-001")!);
    // A job opened without the browser's part (an API client, or before the outline is measured).
    await t.sql`update design_job set status = 'archived'`;
    jobId = (await open({ catalogId: "PART-001", totalQuantity: TOTAL })).id;
    await drain();
  });

  it("before: the server designs from the part's size alone, so without the outline its plan is another", async () => {
    const snap = await snapshot(jobId);
    expect(snap.job.partHash ?? null).toBeNull();
    const view = totalPlanView({ total: TOTAL, sweep: measured.sweep, server: snap.totalPlan });
    expect(view.other?.source).toBe("server");
    // ...and it is the plan the browser makes for the bare box.
    expect(totalPlanView({ total: TOTAL, sweep: bare.sweep, server: snap.totalPlan }).shown?.source).toBe("both");
  });

  it("the measured part replaces it: old results are no longer served, the sweep re-runs for it, and then they agree", async () => {
    const before = await snapshot(jobId);
    const oldIds = before.configurations.map((c) => c.id);
    const r = await put(jobId, designPartBody(measured.part));
    expect(r.changed).toBe(true);
    const hash = designPartHash(measured.part);
    expect(r.job).toMatchObject({ partHash: hash, status: "running", selectedConfigurationId: null });
    const pending = await snapshot(jobId);
    expect(pending.totalPlan).toBeNull();
    expect(pending.configurations.filter((c) => oldIds.includes(c.id))).toEqual([]);
    expect((await pendingSweeps(jobId)).map((x) => x.dedupe_key)).toEqual([sweepDedupeKey(jobId, TOTAL, hash)]);
    const changed = (await t.repo.events.listAfter(DEFAULT_ORG, jobId)).filter((e) => e.type === "job.part_changed");
    expect(changed.at(-1)!.payload).toEqual({ partHash: hash });

    await drain();
    const { snap } = await expectSameAnswer(jobId, measured.sweep);
    expect(snap.job.status).toBe("ready");
  });

  it("the same part again, or the same part without its outline, changes nothing and queues nothing", async () => {
    expect((await put(jobId, designPartBody(measured.part))).changed).toBe(false);
    expect((await put(jobId, designPartBody(bare.part))).changed).toBe(false);
    expect(await pendingSweeps(jobId)).toEqual([]);
    await expectSameAnswer(jobId, measured.sweep);
  });

  it("a sweep that finishes for a part that has since changed stores no plan", async () => {
    expect(await t.repo.jobs.setTotalPlan(DEFAULT_ORG, jobId, TOTAL, { total: TOTAL }, null)).toBe(false);
    expect((await snapshot(jobId)).totalPlan).not.toBeNull();
  });

  it("refuses a part the engine can't design, in the API's words", async () => {
    const res = await putPart(json("PUT", `/jobs/${jobId}/part`, { part: { ...designPartBody(bare.part), mass_kg: -1 } }), params(jobId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request", field: "part.mass_kg" } });
  });
});
