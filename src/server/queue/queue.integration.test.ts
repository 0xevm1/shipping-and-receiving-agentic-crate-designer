// The Postgres job queue against the real database (#46 slice 7, docs/QUEUE.md): SKIP LOCKED
// claims, NOTIFY wake-up and the polling fallback, leases of crashed workers, retries and the dead
// letter, and the sweep job end to end on the engine pool. Needs `bun run infra:up`.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { designShipment } from "@/engine/engine";
import { DesignRequestSchema, DesignSummarySchema } from "@/engine/schemas";
import { DEFAULT_ORG } from "../db/org";
import { createQueueStore, type QueueJob, type QueueStore } from "../db/queue";
import { inTransaction } from "../db/repository";
import { createTestDatabase, type TestDatabase } from "../db/testing";
import { runJobCreatedHooks } from "../jobs/hooks";
import { createEnginePool } from "../workers/engine";
import type { EnginePool } from "../workers/pool";
import { createJobHandlers, createOnDead, enqueueSweep, type SweepJobResult } from "./jobs";
import { pgQueueListen } from "./listen";
import { createQueueRunner, type JobHandler, PermanentJobError, type QueueRunner } from "./runner";

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const waitFor = <T>(fn: () => T | Promise<T>, timeout = 10_000) => vi.waitFor(fn, { timeout, interval: 20 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let t: TestDatabase;
let store: QueueStore;
let pool: EnginePool;
const runners: QueueRunner[] = [];

beforeAll(async () => {
  t = await createTestDatabase("queue");
  store = createQueueStore(t.db);
  pool = createEnginePool(undefined, 2);
});
afterAll(async () => {
  await Promise.all(runners.map((r) => r.stop()));
  await pool?.close();
  await t?.drop();
});
beforeEach(async () => {
  await Promise.all(runners.splice(0).map((r) => r.stop()));
  await t.sql`delete from queue_job`;
});

function runner(handlers: Record<string, JobHandler>, options: Partial<Parameters<typeof createQueueRunner>[0]> = {}): QueueRunner {
  const r = createQueueRunner({ store, handlers, pollIntervalMs: 100, leaseMs: 5_000, log: quiet, ...options });
  runners.push(r);
  return r;
}

const enqueue = (kind = "test", payload: Record<string, unknown> = {}, extra: Partial<Parameters<QueueStore["enqueue"]>[1]> = {}) =>
  store.enqueue(DEFAULT_ORG, { kind, payload, ...extra }).then((r) => r.job);
const reload = async (id: string) => (await store.get(DEFAULT_ORG, id))!;

describe("claiming", () => {
  it("two workers draining one queue never run the same job twice", async () => {
    const jobs = await Promise.all(Array.from({ length: 40 }, (_, i) => enqueue("test", { i })));
    const ran: { worker: string; id: string }[] = [];
    const handler =
      (name: string): JobHandler =>
      async ({ job }) => {
        ran.push({ worker: name, id: job.id });
        await sleep(5);
        return { by: name };
      };
    const a = runner({ test: handler("a") }, { concurrency: 3 });
    const b = runner({ test: handler("b") }, { concurrency: 3 });
    await Promise.all([a.start(), b.start()]);
    await waitFor(async () => {
      const [{ n }] = await t.sql<{ n: number }[]>`select count(*)::int as n from queue_job where status = 'done'`;
      expect(n).toBe(40);
    });
    expect(ran).toHaveLength(40);
    expect(new Set(ran.map((r) => r.id))).toEqual(new Set(jobs.map((j) => j.id)));
    expect(new Set(ran.map((r) => r.worker))).toEqual(new Set(["a", "b"]));
    expect((await reload(jobs[0]!.id)).attempts).toBe(1);
  });

  it("concurrent claims skip each other's locked rows", async () => {
    await Promise.all([1, 2, 3].map((i) => enqueue("test", { i })));
    const claims = await Promise.all(["w1", "w2", "w3", "w4"].map((w) => store.claim(w, 5_000)));
    const ids = claims.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("takes the oldest due job first, and not one whose run_at is still ahead", async () => {
    const later = await enqueue("test", { n: "later" }, { runAt: new Date(Date.now() + 60_000) });
    const first = await enqueue("test", { n: 1 });
    await enqueue("test", { n: 2 });
    expect((await store.claim("w", 1_000))!.id).toBe(first.id);
    expect((await store.claim("w", 1_000))!.payload).toEqual({ n: 2 });
    expect(await store.claim("w", 1_000)).toBeUndefined();
    expect((await reload(later.id)).status).toBe("queued");
  });

  it("claims only the kinds asked for", async () => {
    await enqueue("bundle");
    expect(await store.claim("w", 1_000, ["sweep"])).toBeUndefined();
    expect((await store.claim("w", 1_000, ["bundle"]))!.kind).toBe("bundle");
  });

  it("deduplicates a pending job by key, and allows a new one once it is done", async () => {
    const first = await store.enqueue(DEFAULT_ORG, { kind: "test", payload: {}, dedupeKey: "job-1" });
    const again = await store.enqueue(DEFAULT_ORG, { kind: "test", payload: {}, dedupeKey: "job-1" });
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
    const claimed = (await store.claim("w", 1_000))!;
    expect(await store.complete(claimed.id, "w", null)).toBe(true);
    expect((await store.enqueue(DEFAULT_ORG, { kind: "test", payload: {}, dedupeKey: "job-1" })).created).toBe(true);
  });
});

describe("waking up", () => {
  it("NOTIFY crate_jobs wakes an idle worker at once, long before its next poll", async () => {
    let doneAt = 0;
    const r = runner({ test: async () => void (doneAt = Date.now()) }, { pollIntervalMs: 60_000, listen: pgQueueListen(t.url) });
    await r.start();
    await sleep(300); // Idle, napping until a notification (or a minute from now).
    const sentAt = Date.now();
    const job = await enqueue();
    await waitFor(async () => expect((await reload(job.id)).status).toBe("done"), 5_000);
    expect(doneAt - sentAt).toBeLessThan(2_000);
  });

  it("without LISTEN, polling still picks the job up", async () => {
    const r = runner({ test: async () => "polled" }, { pollIntervalMs: 150 });
    await r.start();
    await sleep(200);
    const job = await enqueue();
    await waitFor(async () => expect(await reload(job.id)).toMatchObject({ status: "done", result: "polled" }), 5_000);
  });
});

describe("failures", () => {
  it("a crashed worker's job is claimed again once its lease runs out", async () => {
    const job = await enqueue();
    const crashed = (await store.claim("crashed-worker", 200))!;
    expect(crashed.id).toBe(job.id);
    // Still leased: nobody else can have it.
    expect(await store.claim("other", 5_000)).toBeUndefined();
    await sleep(300);
    const r = runner({ test: async ({ job: j }) => ({ attempts: j.attempts }) });
    await r.start();
    await waitFor(async () => expect(await reload(job.id)).toMatchObject({ status: "done", attempts: 2, result: { attempts: 2 } }));
    // The crashed worker, coming back, can't overwrite the outcome.
    expect(await store.complete(job.id, "crashed-worker", "late")).toBe(false);
    expect(await store.fail(job.id, "crashed-worker", "late")).toBeUndefined();
    expect((await reload(job.id)).result).toEqual({ attempts: 2 });
  });

  it("a long job keeps its lease while it runs", async () => {
    const job = await enqueue();
    const r = runner({ test: () => sleep(700).then(() => "slow") }, { leaseMs: 300 });
    await r.start();
    await sleep(450);
    expect(await store.claim("thief", 1_000)).toBeUndefined();
    await waitFor(async () => expect(await reload(job.id)).toMatchObject({ status: "done", attempts: 1 }));
  });

  it("retries with backoff, then dead-letters after max_attempts", async () => {
    const onDead = vi.fn(async () => {});
    const job = await enqueue("test", {}, { maxAttempts: 3 });
    const tries: number[] = [];
    const r = runner(
      {
        test: async () => {
          tries.push(Date.now());
          throw new Error("flaky");
        },
      },
      { pollIntervalMs: 20, backoff: { baseMs: 100, maxMs: 1_000 }, onDead },
    );
    await r.start();
    await waitFor(async () => expect(await reload(job.id)).toMatchObject({ status: "dead", attempts: 3, lastError: "flaky" }));
    expect(onDead).toHaveBeenCalledTimes(1);
    // Backoff: 100 ms after the first failure, 200 ms after the second.
    expect(tries[1]! - tries[0]!).toBeGreaterThanOrEqual(90);
    expect(tries[2]! - tries[1]!).toBeGreaterThanOrEqual(190);
    expect((await reload(job.id)).finishedAt).not.toBeNull();
  });

  it("a permanent error, or an unknown kind, dead-letters at once", async () => {
    const bad = await enqueue("test");
    const unknown = await enqueue("mystery");
    const r = runner({
      test: async () => {
        throw new PermanentJobError("bad payload");
      },
      mystery: undefined as never,
    });
    await r.start();
    await waitFor(async () => expect(await reload(bad.id)).toMatchObject({ status: "dead", attempts: 1, lastError: "bad payload" }));
    // `mystery` has no handler in this runner's map entry, so claiming it fails permanently.
    await waitFor(async () => expect(await reload(unknown.id)).toMatchObject({ status: "dead", attempts: 1 }));
  });

  it("a job whose leases ran out max_attempts times is dead-lettered, not run again", async () => {
    const job = await enqueue("test", {}, { maxAttempts: 1 });
    await store.claim("crashed", 50);
    await sleep(100);
    const handler = vi.fn(async () => "ran");
    const r = runner({ test: handler });
    expect(await r.runOnce()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(await reload(job.id)).toMatchObject({ status: "dead", attempts: 2 });
  });
});

describe("the sweep job", () => {
  async function designJob(totalQuantity: number | null = null) {
    const part = await t.repo.parts.create(DEFAULT_ORG, { name: "Bracket", massKg: 21.5, sizeXMm: 300, sizeYMm: 200, sizeZMm: 150, source: "upload" });
    return t.repo.jobs.create(DEFAULT_ORG, { partId: part.id, totalQuantity });
  }

  it("sweeps on the engine pool, saves the shortlist, selects the recommendation and emits configs.ready", async () => {
    const job = await designJob(40);
    const queued = await enqueueSweep(DEFAULT_ORG, job.id, t.repo);
    // A second enqueue while it is pending is the same queue job.
    expect((await enqueueSweep(DEFAULT_ORG, job.id, t.repo)).id).toBe(queued.id);

    const r = runner(createJobHandlers({ db: t.db, pool }), { onDead: createOnDead(t.db) });
    expect(await r.runOnce()).toBe(true);

    const done = await reload(queued.id);
    expect(done.status).toBe("done");
    const result = done.result as SweepJobResult;
    const configs = await t.repo.configurations.listForJob(DEFAULT_ORG, job.id);
    expect(configs.length).toBe(result.count);
    expect(configs.length).toBeGreaterThan(0);
    expect(configs.every((c) => c.origin === "precomputed" && c.engineVersion === result.engineVersion)).toBe(true);
    // Stored like a browser save: the whole DesignRequest (it hashes to the row's inputHash) and its DesignSummary.
    for (const c of configs) {
      const req = DesignRequestSchema.parse(c.settings);
      expect(designShipment(req).inputHash).toBe(c.inputHash);
      expect(DesignSummarySchema.parse(c.resultSummary).totals.crates).toBe(1);
    }
    expect(result.curve).toHaveLength(200);
    expect(result).toMatchObject({ total: 40, totalPlanStored: true });
    const stored = (await t.repo.jobs.get(DEFAULT_ORG, job.id))!.totalPlan as { total: number; plan: { types: { configurationId: string }[] } };
    expect(stored.total).toBe(40);
    // Every crate type of the plan is one of the job's precomputed configurations.
    for (const type of stored.plan.types) expect(configs.some((c) => c.id === type.configurationId)).toBe(true);

    const after = (await t.repo.jobs.get(DEFAULT_ORG, job.id))!;
    expect(after.status).toBe("ready");
    expect(after.selectedConfigurationId).toBe(result.recommendedConfigurationId);
    const best = configs.find((c) => c.id === after.selectedConfigurationId)!;
    expect(best.score).toBe(Math.min(...configs.map((c) => c.score!)));

    const events = await t.repo.events.listAfter(DEFAULT_ORG, job.id);
    expect(events.map((e) => e.type)).toEqual(["configs.ready"]);
    expect(events[0]!.payload).toMatchObject({
      count: configs.length,
      recommendedConfigurationId: best.id,
      inputHash: result.inputHash,
      totalPlan: { total: 40 },
    });
  });

  it("every new design job queues its sweep in the job's own transaction (onJobCreated)", async () => {
    await import("./register");
    const part = await t.repo.parts.create(DEFAULT_ORG, { name: "Hook", massKg: 3, sizeXMm: 100, sizeYMm: 100, sizeZMm: 100, source: "upload" });
    const job = await inTransaction(t.db, async (tx) => {
      const created = await tx.jobs.create(DEFAULT_ORG, { partId: part.id });
      await runJobCreatedHooks(tx, DEFAULT_ORG, created);
      return created;
    });
    const [queued] = await t.sql<{ kind: string; payload: { jobId: string } }[]>`select kind, payload from queue_job where dedupe_key = ${job.id}`;
    expect(queued).toMatchObject({ kind: "sweep", payload: { jobId: job.id } });
    // A rolled-back job leaves no queue row.
    await expect(
      inTransaction(t.db, async (tx) => {
        const created = await tx.jobs.create(DEFAULT_ORG, { partId: part.id });
        await runJobCreatedHooks(tx, DEFAULT_ORG, created);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const [{ n }] = await t.sql<{ n: number }[]>`select count(*)::int as n from queue_job`;
    expect(n).toBe(1);
  });

  it("refuses to queue a sweep for a job that isn't the org's", async () => {
    await expect(enqueueSweep(DEFAULT_ORG, "00000000-0000-4000-8000-00000000ffff", t.repo)).rejects.toThrow(/No design job/);
  });

  it("when it is dead-lettered, the design job goes to error and job.error is emitted", async () => {
    const job = await designJob();
    const queued: QueueJob = (await store.enqueue(DEFAULT_ORG, { kind: "sweep", payload: { jobId: job.id }, maxAttempts: 1 })).job;
    const broken = { run: async () => Promise.reject(new Error("engine thread died")) } as unknown as EnginePool;
    const r = runner(createJobHandlers({ db: t.db, pool: broken }), { onDead: createOnDead(t.db) });
    expect(await r.runOnce()).toBe(true);
    expect(await reload(queued.id)).toMatchObject({ status: "dead", lastError: "engine thread died" });
    expect((await t.repo.jobs.get(DEFAULT_ORG, job.id))!.status).toBe("error");
    const events = await t.repo.events.listAfter(DEFAULT_ORG, job.id);
    expect(events.map((e) => e.type)).toEqual(["job.error"]);
    expect(String(events[0]!.payload.message)).not.toContain("engine thread died");
  });

  it("a bundle job dead-letters when no bundle handler is given", async () => {
    const job = await designJob();
    const queued = (await store.enqueue(DEFAULT_ORG, { kind: "bundle", payload: { jobId: job.id, configurationIds: [] } })).job;
    const r = runner(createJobHandlers({ db: t.db, pool }));
    await r.runOnce();
    expect(await reload(queued.id)).toMatchObject({ status: "dead", attempts: 1 });
  });
});
