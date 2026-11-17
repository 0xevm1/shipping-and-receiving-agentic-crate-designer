// The offline queue (#46 slice 7a) against the real Route Handlers and a scratch Postgres: a
// pending change replayed (a lost response, a second tab) is applied once. The browser's own
// sender, `flushPending`, talks to the handlers through a fetch that calls them directly.
// `bun run test:integration` (after `bun run infra:up`).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { designShipment } from "@/engine/engine";
import type { DesignRequest } from "@/engine/schemas";
import { CreateJobResponseSchema, type SaveConfigurationRequest } from "@/lib/api/jobs";
import { closeDb, DEFAULT_ORG } from "@/server/db";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { peekEventBus } from "@/server/events";
import { enqueueConfig, enqueuePatch, memoryPendingStore, setPendingStore, usePendingChanges } from "@/state/pendingChanges";
import { flushPending } from "@/state/pendingSync";
import { GET, PATCH } from "./[id]/route";
import { POST as saveConfig } from "./[id]/configs/route";
import { POST as createJob } from "./route";

let t: TestDatabase;
const saved = { DATABASE_URL: process.env.DATABASE_URL };

beforeAll(async () => {
  t = await createTestDatabase("offline_queue");
  process.env.DATABASE_URL = t.url;
});
afterAll(async () => {
  await peekEventBus()?.stop();
  (globalThis as { __crateDesignerEventBus?: unknown }).__crateDesignerEventBus = undefined;
  await closeDb();
  Object.assign(process.env, saved);
  await t?.drop();
});
beforeEach(() => setPendingStore(memoryPendingStore()));

const PART = catalog.parts[0]!;

function saveBody(quantity: number): SaveConfigurationRequest {
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

/**
 * `fetch` for the browser code, served by the Route Handlers. `lose` drops the next N answers
 * after the handler ran: the change is applied on the server, the browser never hears back.
 */
function handlerFetch() {
  const f = {
    lose: 0,
    /** Drop the answer to the next request with this method. */
    loseNext: null as string | null,
    calls: [] as string[],
    fetch: (async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const request = new Request(url, { method: init?.method, headers: init?.headers, body: init?.body });
      f.calls.push(`${request.method} ${url.pathname}`);
      const m = /^\/api\/v1\/jobs\/([^/]+)(\/configs)?$/.exec(url.pathname)!;
      const params = { params: Promise.resolve({ id: m[1]! }) };
      const res = m[2] ? await saveConfig(request, params) : request.method === "PATCH" ? await PATCH(request, params) : await GET(request, params);
      if (f.lose > 0 || f.loseNext === request.method) {
        if (f.loseNext === request.method) f.loseNext = null;
        else f.lose--;
        throw new TypeError("Failed to fetch");
      }
      return res;
    }) as unknown as typeof fetch,
  };
  return f;
}

async function newJob() {
  const res = await createJob(
    new Request("http://localhost/api/v1/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogId: PART.id }),
    }),
  );
  return CreateJobResponseSchema.parse(await res.json()).job;
}

const events = async (jobId: string) => (await t.repo.events.listAfter(DEFAULT_ORG, jobId)).map((e) => e.type);

describe("replaying pending changes against the server", () => {
  it("a configuration sent twice (its response lost the first time) is stored once, with one event", async () => {
    const job = await newJob();
    const body = saveBody(3);
    const change = enqueueConfig({ jobId: job.id, partKey: `catalog:${PART.id}`, partName: PART.name, body });
    const net = handlerFetch();
    net.lose = 1;

    const first = await flushPending({ api: { fetch: net.fetch } });
    expect(first.offline).toBe(true);
    expect(usePendingChanges.getState().items.map((c) => c.id)).toEqual([change.id]);

    const second = await flushPending({ api: { fetch: net.fetch } });
    expect(second).toMatchObject({ sent: 1, offline: false });
    expect(usePendingChanges.getState().items).toEqual([]);
    expect(net.calls.filter((c) => c.startsWith("POST"))).toHaveLength(2);

    const rows = await t.sql`select c.id from configuration c join job_configuration jc on jc.configuration_id = c.id where jc.job_id = ${job.id}`;
    expect(rows).toHaveLength(1);
    expect((await events(job.id)).filter((e) => e === "config.added")).toHaveLength(1);
    const keys = await t.sql`select count(*)::int as n from idempotency_key where key = ${change.id}`;
    expect(keys[0]!.n).toBe(1);
  });

  it("the same pending change sent by two tabs at once is applied once", async () => {
    const job = await newJob();
    const change = enqueueConfig({ jobId: job.id, partKey: `catalog:${PART.id}`, partName: PART.name, body: saveBody(5) });
    // Both tabs read the same stored change and send it before either clears it.
    const send = () =>
      saveConfig(
        new Request(`http://localhost/api/v1/jobs/${job.id}/configs`, {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": change.id },
          body: JSON.stringify(change.body),
        }),
        { params: Promise.resolve({ id: job.id }) },
      );
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(await a.json()).toEqual(await b.json());
    expect((await events(job.id)).filter((e) => e === "config.added")).toHaveLength(1);
  });

  it("a job change replayed after a lost response doesn't conflict with itself; the next one goes on top", async () => {
    const job = await newJob();
    const body = saveBody(2);
    enqueueConfig({ jobId: job.id, partKey: `catalog:${PART.id}`, partName: PART.name, body });
    const select = enqueuePatch({
      jobId: job.id,
      partKey: `catalog:${PART.id}`,
      partName: PART.name,
      baseVersion: job.version,
      changes: { select: { inputHash: body.inputHash } },
    });
    enqueuePatch({ jobId: job.id, partKey: `catalog:${PART.id}`, partName: PART.name, baseVersion: job.version, changes: { notes: "Ship Tuesday" } });
    const net = handlerFetch();

    // The configuration goes through; the recommendation is applied but its answer is lost.
    net.loseNext = "PATCH";
    expect((await flushPending({ api: { fetch: net.fetch } })).offline).toBe(true);
    expect(usePendingChanges.getState().items.map((c) => c.id)[0]).toBe(select.id);

    // Sent again with the same key and body: the stored answer, not a version conflict.
    const r = await flushPending({ api: { fetch: net.fetch } });
    expect(r).toMatchObject({ sent: 2, offline: false });
    expect(usePendingChanges.getState().items).toEqual([]);
    const now = await t.sql`select version, notes, selected_configuration_id from design_job where id = ${job.id}`;
    expect(now[0]).toMatchObject({ version: job.version + 2, notes: "Ship Tuesday" });
    expect(now[0]!.selected_configuration_id).not.toBeNull();
    expect((await events(job.id)).filter((e) => e === "recommendation.changed")).toHaveLength(1);
  });
});
