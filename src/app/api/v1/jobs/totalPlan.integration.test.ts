// Total quantity end to end (#46, spec §7.16, docs/API.md "Total quantity"): a job's total is
// planned by the queue's sweep job, stored on the job and served by GET /jobs/:id only while it is
// current; a new total (PATCH) drops the old plan and re-runs the sweep. Against a scratch
// Postgres database, the blob emulator's test bucket and the engine's worker threads.
// `bun run test:integration` (after `bun run infra:up`).
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalog } from "@/domain/catalog";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import type { BundleManifest } from "@/engine/artifacts";
import { planTotal, sweepQuantities } from "@/domain/sweep";
import { DEFAULT_SWEEP_RULES } from "@/engine/sweep";
import { ENGINE_VERSION } from "@/engine/version";
import { ArtifactUrlResponseSchema, BundleResponseSchema } from "@/lib/api/artifacts";
import { CreateJobResponseSchema, JobSnapshotSchema, PatchJobResponseSchema } from "@/lib/api/jobs";
import { resetBlobStore } from "@/server/blob";
import { testBlobConfig } from "@/server/blob/testing";
import { closeDb, DEFAULT_ORG } from "@/server/db";
import { createQueueStore } from "@/server/db/queue";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { peekEventBus } from "@/server/events";
import { createJobHandlers, replanTotals, sweepDedupeKey } from "@/server/queue/jobs";
import { createQueueRunner } from "@/server/queue/runner";
import { closeEnginePool, getEnginePool } from "@/server/workers/engine";
import { GET as bundleGET } from "./[id]/bundle.zip/route";
import { GET as fileGET } from "./[id]/configs/[cid]/[file]/route";
import { GET, PATCH } from "./[id]/route";
import { POST as createJob } from "./route";

const BASE = "http://localhost/api/v1";
const PART = catalog.parts[0]!;
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

let t: TestDatabase;
const saved = { DATABASE_URL: process.env.DATABASE_URL, BLOB_BUCKET: process.env.BLOB_BUCKET };

beforeAll(async () => {
  t = await createTestDatabase("total_plan");
  process.env.DATABASE_URL = t.url;
  process.env.BLOB_BUCKET = testBlobConfig().bucket;
  resetBlobStore();
});
afterAll(async () => {
  await peekEventBus()?.stop();
  (globalThis as { __crateDesignerEventBus?: unknown }).__crateDesignerEventBus = undefined;
  await closeEnginePool();
  await closeDb();
  resetBlobStore();
  Object.assign(process.env, saved);
  await t?.drop();
});

const json = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function snapshot(id: string) {
  const res = await GET(new Request(`${BASE}/jobs/${id}`), params(id));
  expect(res.status).toBe(200);
  return JobSnapshotSchema.parse(await res.json());
}

async function patch(id: string, body: Record<string, unknown>, key?: string) {
  const res = await PATCH(json("PATCH", `/jobs/${id}`, body, key ? { "Idempotency-Key": key } : {}), params(id));
  expect(res.status).toBe(200);
  return PatchJobResponseSchema.parse(await res.json()).job;
}

/** Runs the queue until it is empty, as `bun run worker` would. */
async function drain() {
  const runner = createQueueRunner({ store: createQueueStore(t.db), handlers: createJobHandlers({ db: t.db, pool: getEnginePool() }), log: quiet });
  while (await runner.runOnce()) {
    // one job at a time
  }
}

const pendingSweeps = (jobId: string) =>
  t.sql<{ dedupe_key: string }[]>`select dedupe_key from queue_job where kind = 'sweep' and status in ('queued', 'running') and payload->>'jobId' = ${jobId}`;

/** The plan the browser makes for the same part, rules and standards: the server's must match it. */
const browserPlan = (total: number) => planTotal(sweepQuantities({ ...PART }, { ...DEFAULT_SWEEP_RULES, quantity: 1 }, DEFAULT_STANDARDS), total)!;

describe("total quantity on a job", () => {
  let jobId: string;

  beforeAll(async () => {
    const res = await createJob(json("POST", "/jobs", { catalogId: PART.id, totalQuantity: 40 }));
    expect(res.status).toBe(201);
    jobId = CreateJobResponseSchema.parse(await res.json()).job.id;
  });

  it("a job opened with a total queues its sweep under the job and total, and has no plan until it runs", async () => {
    expect((await pendingSweeps(jobId)).map((r) => r.dedupe_key)).toEqual([sweepDedupeKey(jobId, 40)]);
    expect((await snapshot(jobId)).totalPlan).toBeNull();
  });

  it("the sweep stores the plan, links each crate type's configuration, and configs.ready carries it", async () => {
    await drain();
    const snap = await snapshot(jobId);
    const plan = snap.totalPlan!;
    expect(plan).toMatchObject({ total: 40, engineVersion: ENGINE_VERSION, basis: "crate-only" });
    // The same engine in the browser makes the same plan.
    const mine = browserPlan(40);
    expect(plan.plan).toMatchObject({ crates: mine.crates, perCrate: mine.perCrate });
    expect(plan.plan!.scoreUsdPerPart).toBeCloseTo(mine.scoreUsdPerPart, 9);
    expect(plan.plan!.types.map((x) => [x.count, x.quantity, x.layoutKey])).toEqual(mine.types.map((x) => [x.count, x.quantity, x.crate.layoutKey]));
    expect(plan.rationale.join("")).toMatch(/^40 parts ship as /);
    for (const type of plan.plan!.types) {
      const c = snap.configurations.find((x) => x.id === type.configurationId)!;
      expect(c).toMatchObject({ origin: "precomputed", quantityPerCrate: type.quantity, layout: type.layoutKey });
    }
    const ready = (await t.repo.events.listAfter(DEFAULT_ORG, jobId)).filter((e) => e.type === "configs.ready");
    expect(ready.at(-1)!.payload).toMatchObject({ totalPlan: { total: 40, crates: mine.crates, perCrate: mine.perCrate } });
  });

  it("a plan's crate type has its files from the server (artifact links)", async () => {
    const type = (await snapshot(jobId)).totalPlan!.plan!.types[0]!;
    const cid = type.configurationId!;
    const res = await fileGET(new Request(`${BASE}/jobs/${jobId}/configs/${cid}/cutlist.csv`), {
      params: Promise.resolve({ id: jobId, cid, file: "cutlist.csv" }),
    });
    expect(res.status).toBe(200);
    expect(ArtifactUrlResponseSchema.parse(await res.json())).toMatchObject({ kind: "csv" });
  });

  it("the shipment-level files (cutlist.csv, spec.pdf, bundle.zip) describe the whole shipment: the job's total, as the browser's export does (#140)", async () => {
    const snap = await snapshot(jobId);
    const plan = snap.totalPlan!.plan!;
    const cid = plan.types[0]!.configurationId!;
    const own = snap.configurations.find((c) => c.id === cid)!;
    const file = async (name: string) => {
      const res = await fileGET(new Request(`${BASE}/jobs/${jobId}/configs/${cid}/${name}`), { params: Promise.resolve({ id: jobId, cid, file: name }) });
      expect(res.status).toBe(200);
      return ArtifactUrlResponseSchema.parse(await res.json());
    };
    const csv = await file("cutlist.csv");
    const pdf = await file("spec.pdf");
    // Not the crate's own request: the request for the total, with its own hash (and so its own stored file).
    expect(csv.inputHash).not.toBe(own.inputHash);
    expect(pdf.inputHash).toBe(csv.inputHash);
    expect(csv.fileName).toMatch(/-x40-shipment\.csv$/);
    const body = await (await fetch(csv.url)).text();
    expect(body).toMatch(/^# Shipment of 40 x /);
    expect(body).toContain(`input ${csv.inputHash}`);
    // The crate's own GLB stays the crate's.
    expect((await file("crate.glb")).inputHash).toBe(own.inputHash);

    // The bundle holds the total once, whatever configurations the job has.
    const res = await bundleGET(new Request(`${BASE}/jobs/${jobId}/bundle.zip`), { params: Promise.resolve({ id: jobId }) });
    expect(res.status).toBe(200);
    const b = BundleResponseSchema.parse(await res.json());
    if (b.status !== "ready") throw new Error("expected a ready bundle");
    const files = unzipSync(new Uint8Array(await (await fetch(b.url)).arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]!)) as BundleManifest;
    expect(manifest.configurations).toHaveLength(1);
    expect(manifest.configurations[0]).toMatchObject({ quantity: 40, total: 40, inputHash: csv.inputHash, perCrate: plan.types.map((t) => t.quantity) });
    expect(Object.keys(files).some((p) => p.endsWith(`-x40-shipment.csv`))).toBe(true);
  }, 60_000);

  it("PATCH to a new total drops the old plan at once, re-runs the sweep, and serves the new plan", async () => {
    const { version } = (await snapshot(jobId)).job;
    const job = await patch(jobId, { version, totalQuantity: 100 });
    expect(job.totalQuantity).toBe(100);
    // The plan for 40 is never served as the plan for 100.
    expect((await snapshot(jobId)).totalPlan).toBeNull();
    expect((await pendingSweeps(jobId)).map((r) => r.dedupe_key)).toEqual([sweepDedupeKey(jobId, 100)]);
    await drain();
    const plan = (await snapshot(jobId)).totalPlan!;
    expect(plan.total).toBe(100);
    expect(plan.plan!.types.reduce((s, x) => s + x.count * x.quantity, 0)).toBe(100);
    expect(plan.plan!.crates).toBe(browserPlan(100).crates);
  });

  it("the same total again, or other fields, queue nothing and keep the plan", async () => {
    const { version } = (await snapshot(jobId)).job;
    await patch(jobId, { version, totalQuantity: 100, notes: "same total" });
    expect(await pendingSweeps(jobId)).toEqual([]);
    expect((await snapshot(jobId)).totalPlan?.total).toBe(100);
  });

  it("a sweep that planned a total someone has since changed stores nothing", async () => {
    const { version } = (await snapshot(jobId)).job;
    await patch(jobId, { version, totalQuantity: 120 });
    // A late sweep for 100 (it started before the change) tries to store its plan.
    expect(await t.repo.jobs.setTotalPlan(DEFAULT_ORG, jobId, 100, { total: 100 })).toBe(false);
    expect((await t.repo.jobs.get(DEFAULT_ORG, jobId))!.totalPlan).toBeNull();
    await drain();
    expect((await snapshot(jobId)).totalPlan?.total).toBe(120);
  });

  it("a plan from another engine version is never served, and a new engine re-plans it", async () => {
    await t.sql`update design_job set total_plan = jsonb_set(total_plan, '{engineVersion}', '"0.0.1+engine.old"') where id = ${jobId}`;
    expect((await snapshot(jobId)).totalPlan).toBeNull();
    expect(await replanTotals(t.repo, DEFAULT_ORG, ENGINE_VERSION)).toBeGreaterThanOrEqual(1);
    expect((await pendingSweeps(jobId)).map((r) => r.dedupe_key)).toEqual([sweepDedupeKey(jobId, 120)]);
    await drain();
    expect((await snapshot(jobId)).totalPlan).toMatchObject({ total: 120, engineVersion: ENGINE_VERSION });
    expect(await replanTotals(t.repo, DEFAULT_ORG, ENGINE_VERSION)).toBe(0);
  });

  it("an offline total change replayed with its Idempotency-Key is applied once, with one sweep", async () => {
    const { version } = (await snapshot(jobId)).job;
    const key = "pending-change-total-1";
    const first = await patch(jobId, { version, totalQuantity: 60 }, key);
    // The response was lost; the tab sends the same change again.
    const again = await patch(jobId, { version, totalQuantity: 60 }, key);
    expect(again).toEqual(first);
    expect(first.version).toBe(version + 1);
    expect((await pendingSweeps(jobId)).map((r) => r.dedupe_key)).toEqual([sweepDedupeKey(jobId, 60)]);
    await drain();
    expect((await snapshot(jobId)).totalPlan?.total).toBe(60);
  });

  it("clearing the total clears the plan and queues nothing", async () => {
    const { version } = (await snapshot(jobId)).job;
    await patch(jobId, { version, totalQuantity: null });
    const snap = await snapshot(jobId);
    expect(snap.job.totalQuantity).toBeNull();
    expect(snap.totalPlan).toBeNull();
    expect(await pendingSweeps(jobId)).toEqual([]);
  });
});
