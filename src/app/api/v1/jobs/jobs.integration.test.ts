// /api/v1/jobs* end to end (#46 slice 5): the Route Handlers themselves, called with a Request,
// against a scratch Postgres database. `bun run test:integration` (after `bun run infra:up`).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { designShipment } from "@/engine/engine";
import type { DesignRequest } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import {
  CreateJobResponseSchema,
  EngineMismatchErrorSchema,
  JobSnapshotSchema,
  PatchJobResponseSchema,
  SaveConfigurationResponseSchema,
  VersionConflictErrorSchema,
} from "@/lib/api/jobs";
import { ApiErrorSchema } from "@/lib/api/parts";
import type { JobEventMessage } from "@/lib/events";
import { closeDb, DEFAULT_ORG, getDb, orgContext } from "@/server/db";
import { org } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { peekEventBus } from "@/server/events";
import { onJobCreated, saveConfiguration } from "@/server/jobs";
import { checkConfiguration } from "@/server/jobs/check";
import { closeEnginePool, getEnginePool } from "@/server/workers/engine";
import { GET as eventsGET } from "../events/route";
import { GET, PATCH } from "./[id]/route";
import { POST as saveConfig } from "./[id]/configs/route";
import { POST as createJob } from "./route";

let t: TestDatabase;
const saved = { DATABASE_URL: process.env.DATABASE_URL };

beforeAll(async () => {
  t = await createTestDatabase("jobs_api");
  process.env.DATABASE_URL = t.url;
});
afterAll(async () => {
  await peekEventBus()?.stop();
  (globalThis as { __crateDesignerEventBus?: unknown }).__crateDesignerEventBus = undefined;
  await closeDb();
  await closeEnginePool();
  Object.assign(process.env, saved);
  await t?.drop();
});

const BASE = "http://localhost/api/v1";
const PART = catalog.parts[0]!;

function jsonRequest(method: string, path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function newJob(body: Record<string, unknown> = { catalogId: PART.id }) {
  const res = await createJob(jsonRequest("POST", "/jobs", body));
  expect(res.status).toBe(201);
  return CreateJobResponseSchema.parse(await res.json()).job;
}

const snapshot = async (id: string) => {
  const res = await GET(new Request(`${BASE}/jobs/${id}`), params(id));
  return { res, body: res.ok ? JobSnapshotSchema.parse(await res.json()) : ApiErrorSchema.parse(await res.json()) };
};

/** What the browser posts: the engine's request and, round-tripped through JSON, its answer. */
function saveBody(quantity = 4, layoutKey: string | null = null) {
  const request: DesignRequest = {
    part: { id: PART.id, name: PART.name, mass_kg: PART.mass_kg, dimensions_mm: PART.dimensions_mm, material: PART.material },
    settings: { ...DEFAULT_SETTINGS, quantity },
    standards: DEFAULT_STANDARDS,
    layoutKey,
    ranking: "volume",
  };
  const out = designShipment(request);
  return JSON.parse(JSON.stringify({ request, engineVersion: out.engineVersion, inputHash: out.inputHash, summary: out.summary }));
}

const save = (jobId: string, body: unknown, headers: Record<string, string> = {}) =>
  saveConfig(jsonRequest("POST", `/jobs/${jobId}/configs`, body, headers), params(jobId));

const events = (jobId: string) => t.repo.events.listAfter(DEFAULT_ORG, jobId);

describe("POST /api/v1/jobs", () => {
  it("registers a catalog part once and opens a job, emitting part.created and job.created", async () => {
    const job = await newJob({ catalogId: "PART-002", totalQuantity: 40 });
    expect(job).toMatchObject({ status: "open", totalQuantity: 40, version: 1, selectedConfigurationId: null });
    expect((await events(job.id)).map((e) => e.type)).toEqual(["job.created"]);
    const parts = (await t.repo.parts.list(DEFAULT_ORG)).filter((p) => p.catalogId === "PART-002");
    expect(parts).toHaveLength(1);
    const partEvents = await t.sql`select payload from event where type = 'part.created' and job_id is null`;
    expect(partEvents.map((r) => r.payload.partId)).toContain(parts[0]!.id);

    // A second job for the same catalog part reuses the part row.
    await newJob({ catalogId: "PART-002" });
    expect((await t.repo.parts.list(DEFAULT_ORG)).filter((p) => p.catalogId === "PART-002")).toHaveLength(1);
  });

  it("reuses the open job for the same part with reuse: true", async () => {
    const first = await createJob(jsonRequest("POST", "/jobs", { catalogId: "PART-003", reuse: true }));
    expect(first.status).toBe(201);
    const again = await createJob(jsonRequest("POST", "/jobs", { catalogId: "PART-003", reuse: true }));
    expect(again.status).toBe(200);
    const a = CreateJobResponseSchema.parse(await first.json());
    const b = CreateJobResponseSchema.parse(await again.json());
    expect(b).toEqual({ job: a.job, created: false });
  });

  it("runs onJobCreated hooks inside the creating transaction", async () => {
    const seen: string[] = [];
    const off = onJobCreated(async (_tx, _ctx, job) => void seen.push(job.id));
    const job = await newJob();
    off();
    expect(seen).toEqual([job.id]);
  });

  it("refuses an unknown part, a bad body and a missing catalog entry", async () => {
    expect((await createJob(jsonRequest("POST", "/jobs", { partId: randomUUID() }))).status).toBe(404);
    expect((await createJob(jsonRequest("POST", "/jobs", {}))).status).toBe(400);
    expect((await createJob(jsonRequest("POST", "/jobs", { catalogId: "NOPE" }))).status).toBe(404);
    const notJson = new Request(`${BASE}/jobs`, { method: "POST", body: "x", headers: { "content-type": "text/plain" } });
    expect((await createJob(notJson)).status).toBe(415);
  });
});

describe("GET /api/v1/jobs/:id", () => {
  it("returns the job, its part, configurations, artifacts and the last event id", async () => {
    const job = await newJob();
    await save(job.id, saveBody(3));
    const { res, body } = await snapshot(job.id);
    expect(res.status).toBe(200);
    const snap = JobSnapshotSchema.parse(body);
    expect(snap.job.id).toBe(job.id);
    expect(snap.part).toMatchObject({ source: "catalog", catalogId: PART.id, name: PART.name });
    expect(snap.configurations).toHaveLength(1);
    expect(snap.configurations[0]).toMatchObject({ origin: "user", engineVersion: ENGINE_VERSION, design: { layoutKey: null, ranking: "volume" } });
    expect(snap.artifacts).toEqual([]);
    expect(snap.engineVersion).toBe(ENGINE_VERSION);
    const last = (await t.repo.events.listForStream(DEFAULT_ORG, job.id)).at(-1)!;
    expect(snap.lastEventId).toBe(last.id);
  });

  it("answers 404 for a job of another org, and for a malformed id", async () => {
    const [row] = await t.db
      .insert(org)
      .values({ slug: `other-${randomUUID()}`, name: "Other" })
      .returning();
    const other = orgContext(row!.id);
    const part = await t.repo.parts.create(other, { name: "Theirs", massKg: 2, sizeXMm: 10, sizeYMm: 10, sizeZMm: 10, source: "upload" });
    const theirs = await t.repo.jobs.create(other, { partId: part.id });
    expect((await snapshot(theirs.id)).res.status).toBe(404);
    expect((await save(theirs.id, saveBody())).status).toBe(404);
    expect((await PATCH(jsonRequest("PATCH", `/jobs/${theirs.id}`, { version: 1, notes: "x" }), params(theirs.id))).status).toBe(404);
    expect((await createJob(jsonRequest("POST", "/jobs", { partId: part.id }))).status).toBe(404);
    expect((await snapshot("not-a-uuid")).res.status).toBe(404);
  });
});

describe("POST /api/v1/jobs/:id/configs", () => {
  it("recomputes, stores and emits config.added", async () => {
    const job = await newJob();
    const body = saveBody(6);
    const res = await save(job.id, body);
    expect(res.status).toBe(201);
    const { configuration, created } = SaveConfigurationResponseSchema.parse(await res.json());
    expect(created).toBe(true);
    expect(configuration).toMatchObject({ inputHash: body.inputHash, quantityPerCrate: 6, origin: "user" });
    expect(configuration.score).toBeCloseTo(body.summary.totals.costUsd / body.summary.totals.parts);
    const added = (await events(job.id)).filter((e) => e.type === "config.added");
    expect(added.map((e) => e.payload)).toEqual([{ configurationId: configuration.id, inputHash: body.inputHash }]);
  });

  it("is idempotent: the same configuration twice is one row, one link and one event", async () => {
    const job = await newJob();
    const body = saveBody(5);
    const a = SaveConfigurationResponseSchema.parse(await (await save(job.id, body)).json());
    const res = await save(job.id, body);
    expect(res.status).toBe(200);
    const b = SaveConfigurationResponseSchema.parse(await res.json());
    expect(b.created).toBe(false);
    expect(b.configuration.id).toBe(a.configuration.id);
    expect((await events(job.id)).filter((e) => e.type === "config.added")).toHaveLength(1);
    const rows = await t.sql`select count(*)::int as n from configuration where input_hash = ${body.inputHash}`;
    expect(rows[0]!.n).toBe(1);

    // Another job with the same inputs shares the row through its own link.
    const job2 = await newJob();
    const c = SaveConfigurationResponseSchema.parse(await (await save(job2.id, body)).json());
    expect(c).toMatchObject({ created: true, configuration: { id: a.configuration.id } });
  });

  it("honours Idempotency-Key: a repeat gets the stored answer, a different body with the key 422", async () => {
    const job = await newJob();
    const key = `save-${randomUUID()}`;
    const first = await save(job.id, saveBody(7), { "Idempotency-Key": key });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const repeat = await save(job.id, saveBody(7), { "Idempotency-Key": key });
    expect(repeat.status).toBe(201);
    expect(await repeat.json()).toEqual(firstBody);
    expect((await events(job.id)).filter((e) => e.type === "config.added")).toHaveLength(1);
    // Replayed concurrently: still one answer.
    const both = await Promise.all([
      save(job.id, saveBody(8), { "Idempotency-Key": `${key}-2` }),
      save(job.id, saveBody(8), { "Idempotency-Key": `${key}-2` }),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    const other = await save(job.id, saveBody(9), { "Idempotency-Key": key });
    expect(other.status).toBe(422);
    expect(ApiErrorSchema.parse(await other.json()).error.code).toBe("idempotency_conflict");
  });

  it("refuses a tampered result (422) and a tampered hash (422), storing nothing", async () => {
    const job = await newJob();
    const body = saveBody(4);
    const cheaper = structuredClone(body);
    cheaper.summary.totals.costUsd = 1;
    const res = await save(job.id, cheaper);
    expect(res.status).toBe(422);
    expect(ApiErrorSchema.parse(await res.json()).error).toMatchObject({ code: "result_mismatch", field: "summary" });
    const badHash = { ...body, inputHash: "0".repeat(64) };
    const res2 = await save(job.id, badHash);
    expect(res2.status).toBe(422);
    expect(ApiErrorSchema.parse(await res2.json()).error).toMatchObject({ code: "result_mismatch", field: "inputHash" });
    // A request edited after the design (more parts than the summary says) is caught too.
    const edited = structuredClone(body);
    edited.request.settings.quantity = 9;
    expect((await save(job.id, edited)).status).toBe(422);
    expect((await snapshot(job.id)).body).toMatchObject({ configurations: [] });
    expect((await events(job.id)).filter((e) => e.type === "config.added")).toHaveLength(0);
  });

  it("answers another engine version with 409 and the server's version, so the tab reloads", async () => {
    const job = await newJob();
    const res = await save(job.id, { ...saveBody(), engineVersion: "0.0.1+engine.0" });
    expect(res.status).toBe(409);
    const body = EngineMismatchErrorSchema.parse(await res.json());
    expect(body.engineVersion).toBe(ENGINE_VERSION);
  });

  it("recomputes in an engine worker thread, with no transaction open meanwhile", async () => {
    const job = await newJob();
    let openTransactions = -1;
    const res = await saveConfiguration(job.id, jsonRequest("POST", `/jobs/${job.id}/configs`, saveBody(5)), {
      db: getDb(),
      org: DEFAULT_ORG,
      check: async (input) => {
        const [row] = await t.sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`;
        openTransactions = row!.n as number;
        return checkConfiguration(input);
      },
    });
    expect(res.status).toBe(201);
    expect(openTransactions).toBe(0);
    // The route itself sends the check to the process's engine pool.
    const before = getEnginePool().stats();
    expect((await save(job.id, saveBody(6))).status).toBe(201);
    expect(getEnginePool().stats().threads).toBeGreaterThanOrEqual(Math.max(1, before.threads));
  });

  it("answers a repeated Idempotency-Key from storage without running the engine again", async () => {
    const job = await newJob();
    const key = `save-${randomUUID()}`;
    const first = await save(job.id, saveBody(10), { "Idempotency-Key": key });
    expect(first.status).toBe(201);
    const repeat = await saveConfiguration(job.id, jsonRequest("POST", `/jobs/${job.id}/configs`, saveBody(10), { "Idempotency-Key": key }), {
      db: getDb(),
      org: DEFAULT_ORG,
      check: () => Promise.reject(new Error("the engine must not run for a replay")),
    });
    expect(repeat).toMatchObject({ status: 201, replayed: true, body: await first.json() });
  });

  it("answers an unknown job with 404 before running the engine", async () => {
    const res = await saveConfiguration(randomUUID(), jsonRequest("POST", `/jobs/x/configs`, saveBody()), {
      db: getDb(),
      org: DEFAULT_ORG,
      check: () => Promise.reject(new Error("the engine must not run for a missing job")),
    }).catch((e: unknown) => e);
    expect(res).toMatchObject({ status: 404, code: "not_found" });
  });

  it("answers an invalid design request with 400", async () => {
    const job = await newJob();
    const body = saveBody();
    body.request.settings.quantity = -1;
    expect((await save(job.id, body)).status).toBe(400);
  });
});

describe("PATCH /api/v1/jobs/:id", () => {
  it("selects a configuration at the current version, emits recommendation.changed, and 409s a stale one", async () => {
    const job = await newJob();
    const { configuration } = SaveConfigurationResponseSchema.parse(await (await save(job.id, saveBody(2))).json());
    const res = await PATCH(jsonRequest("PATCH", `/jobs/${job.id}`, { version: 1, selectedConfigurationId: configuration.id }), params(job.id));
    expect(res.status).toBe(200);
    const updated = PatchJobResponseSchema.parse(await res.json()).job;
    expect(updated).toMatchObject({ version: 2, selectedConfigurationId: configuration.id });
    const changed = (await events(job.id)).filter((e) => e.type === "recommendation.changed");
    expect(changed.map((e) => e.payload)).toEqual([{ configurationId: configuration.id }]);

    // Notes alone don't move the recommendation.
    const notes = await PATCH(jsonRequest("PATCH", `/jobs/${job.id}`, { version: 2, notes: "ship Tuesday" }), params(job.id));
    expect(PatchJobResponseSchema.parse(await notes.json()).job).toMatchObject({ version: 3, notes: "ship Tuesday" });
    expect((await events(job.id)).filter((e) => e.type === "recommendation.changed")).toHaveLength(1);

    const stale = await PATCH(jsonRequest("PATCH", `/jobs/${job.id}`, { version: 1, status: "ready" }), params(job.id));
    expect(stale.status).toBe(409);
    const conflict = VersionConflictErrorSchema.parse(await stale.json());
    expect(conflict.job).toMatchObject({ version: 3, notes: "ship Tuesday", status: "open" });
  });

  it("refuses to select a configuration the job doesn't have (422) and an empty patch (400)", async () => {
    const job = await newJob();
    const other = await newJob();
    const { configuration } = SaveConfigurationResponseSchema.parse(await (await save(other.id, saveBody(11))).json());
    const res = await PATCH(jsonRequest("PATCH", `/jobs/${job.id}`, { version: 1, selectedConfigurationId: configuration.id }), params(job.id));
    expect(res.status).toBe(422);
    expect((await PATCH(jsonRequest("PATCH", `/jobs/${job.id}`, { version: 1 }), params(job.id))).status).toBe(400);
  });

  it("applies a PATCH replayed with the same Idempotency-Key once", async () => {
    const job = await newJob();
    const req = () => PATCH(jsonRequest("PATCH", `/jobs/${job.id}`, { version: 1, status: "ready" }, { "Idempotency-Key": `patch-${job.id}` }), params(job.id));
    const a = await req();
    const b = await req();
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await b.json()).toEqual(await a.json());
    expect((await t.repo.jobs.get(DEFAULT_ORG, job.id))?.version).toBe(2);
  });
});

describe("events on the SSE route", () => {
  it("delivers config.added to a subscriber of the job", async () => {
    const job = await newJob();
    const abort = new AbortController();
    const res = await eventsGET(new Request(`${BASE}/events?job=${job.id}`, { signal: abort.signal }));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const got: JobEventMessage[] = [];
    const reading = (async () => {
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const data = /^data: (.*)$/m.exec(buffer.slice(0, end))?.[1];
          buffer = buffer.slice(end + 2);
          if (data) got.push(JSON.parse(data));
        }
      }
    })();
    await vi.waitFor(() => expect(got.some((m) => m.type === "job.created")).toBe(true), { timeout: 5000 });
    const saved = SaveConfigurationResponseSchema.parse(await (await save(job.id, saveBody(10))).json());
    await vi.waitFor(
      () =>
        expect(got.find((m) => m.type === "config.added")?.payload).toEqual({
          configurationId: saved.configuration.id,
          inputHash: saved.configuration.inputHash,
        }),
      {
        timeout: 5000,
      },
    );
    abort.abort();
    await reader.cancel().catch(() => {});
    await reading;
  });
});
