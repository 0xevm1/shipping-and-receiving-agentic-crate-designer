// LISTEN/NOTIFY and the SSE stream against the real Postgres (#46 §3). Needs `bun run infra:up`.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EventNotification, JobEventMessage } from "@/lib/events";
import { DEFAULT_ORG, type OrgContext, orgContext } from "@/server/db/org";
import { type CrateEvent, type DesignJob, inTransaction } from "@/server/db/repository";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import type { EventBus } from "./bus";
import { emitEvent } from "./emit";
import { createPgEventBus, type PgEventBusOptions } from "./pgEventBus";
import { handleJobEventsRequest } from "./sse";

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const waitFor = <T>(fn: () => T | Promise<T>, timeout = 10_000) => vi.waitFor(fn, { timeout, interval: 25 });

let t: TestDatabase;
let bus: EventBus;
let job: DesignJob;
const appName = `crate-events-it-${randomBytes(3).toString("hex")}`;

function newBus(url = t.url, applicationName = appName, overrides: Partial<PgEventBusOptions> = {}) {
  return createPgEventBus({
    url,
    system: t.system,
    probeIntervalMs: 150,
    probeTimeoutMs: 400,
    backoffInitialMs: 25,
    backoffMaxMs: 300,
    applicationName,
    log: quiet,
    ...overrides,
  });
}

/** A log that keeps the bus's warnings. */
function warnings() {
  const seen: string[] = [];
  return { seen, log: { ...quiet, warn: (m: string) => void seen.push(m) } };
}

const busyWait = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

async function newJob(ctx: OrgContext = DEFAULT_ORG): Promise<DesignJob> {
  const part = await t.repo.parts.create(ctx, { name: "Bracket", massKg: 2, sizeXMm: 100, sizeYMm: 100, sizeZMm: 100, source: "upload" });
  return t.repo.jobs.create(ctx, { partId: part.id });
}

/** One committed event, as a route handler would write it. */
const emit = (message: string, jobId = job.id, ctx: OrgContext = DEFAULT_ORG) =>
  inTransaction(t.db, (tx) => emitEvent(tx, ctx, { jobId, type: "job.error", payload: { message } }));

/** Opens the SSE stream the way the route does, and collects its messages as they arrive. */
async function openStream(opts: { jobId?: string; ctx?: OrgContext; lastEventId?: number | string; query?: string; pageSize?: number; bus?: EventBus } = {}) {
  const abort = new AbortController();
  const headers = new Headers();
  if (opts.lastEventId !== undefined) headers.set("Last-Event-ID", String(opts.lastEventId));
  const request = new Request(`http://test/api/v1/events?job=${opts.jobId ?? job.id}${opts.query ?? ""}`, { headers, signal: abort.signal });
  const response = await handleJobEventsRequest(request, {
    ctx: opts.ctx ?? DEFAULT_ORG,
    repo: t.repo,
    bus: opts.bus ?? bus,
    pageSize: opts.pageSize,
    heartbeatMs: 60_000,
    log: quiet,
  });
  const messages: { id: number; data: JobEventMessage }[] = [];
  const reader = response.body?.getReader();
  const done = (async () => {
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const id = /^id: (\d+)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (id && data) messages.push({ id: Number(id), data: JSON.parse(data) });
      }
    }
  })();
  const close = async () => {
    abort.abort();
    await reader?.cancel().catch(() => {});
    await done;
  };
  // Job-scoped ids only: org-wide events (engine.updated) from other tests appear on every stream.
  const ids = () => messages.filter((m) => m.data.jobId !== null).map((m) => m.id);
  return { response, messages, ids, close };
}

beforeAll(async () => {
  t = await createTestDatabase("events");
  bus = newBus();
  await bus.start();
  job = await newJob();
});

afterAll(async () => {
  await bus?.stop();
  await t?.drop();
});

const streams: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(streams.splice(0).map((s) => s.close()));
});
const track = <S extends { close(): Promise<void> }>(s: S) => (streams.push(s), s);

describe("NOTIFY trigger and listener", () => {
  it("uses one dedicated listen connection, outside the pool", async () => {
    const rows = await t.sql`select count(*)::int as n from pg_stat_activity where application_name = ${appName} and query ilike 'listen%'`;
    expect(rows[0]?.n).toBe(1);
  });

  it("delivers an event after its transaction commits, and never one that rolls back", async () => {
    const got: EventNotification[] = [];
    const off = bus.subscribe(job.id, { onEvent: (n) => void got.push(n) });
    try {
      let pending = 0;
      const committed = await inTransaction(t.db, async (tx) => {
        const row = await emitEvent(tx, DEFAULT_ORG, { jobId: job.id, type: "configs.ready", payload: { count: 3 } });
        // A round trip on another connection while this one is still open: nothing yet.
        await t.sql`select pg_sleep(0.1)`;
        pending = got.length;
        return row;
      });
      expect(pending).toBe(0);
      await waitFor(() => expect(got.map((n) => n.id)).toEqual([committed.id]));
      expect(got[0]).toEqual({ id: committed.id, orgId: DEFAULT_ORG.orgId, jobId: job.id, type: "configs.ready" });

      await expect(
        inTransaction(t.db, async (tx) => {
          await emitEvent(tx, DEFAULT_ORG, { jobId: job.id, type: "job.error", payload: { message: "never" } });
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      const after = await emit("after the rollback");
      // Notifications arrive in commit order, so once `after` is here the rolled-back one never will be.
      await waitFor(() => expect(got.map((n) => n.id)).toEqual([committed.id, after.id]));
    } finally {
      off();
    }
  });

  it("refuses an invalid payload, and a job-scoped type without a job", async () => {
    await expect(inTransaction(t.db, (tx) => emitEvent(tx, DEFAULT_ORG, { jobId: job.id, type: "configs.ready", payload: { count: -1 } }))).rejects.toThrow();
    await expect(inTransaction(t.db, (tx) => emitEvent(tx, DEFAULT_ORG, { jobId: null, type: "configs.ready", payload: { count: 1 } }))).rejects.toThrow(
      /needs a jobId/,
    );
  });

  it("drops a slow subscriber without holding up the others", async () => {
    const fast: number[] = [];
    const dropped = vi.fn();
    const offSlow = bus.subscribe(job.id, { onEvent: () => new Promise(() => {}), onDrop: dropped }, { maxBuffered: 2 });
    const offFast = bus.subscribe(job.id, { onEvent: (n) => void fast.push(n.id) });
    try {
      const rows = await inTransaction(t.db, async (tx) => {
        const out = [];
        for (let i = 0; i < 8; i++) out.push(await emitEvent(tx, DEFAULT_ORG, { jobId: job.id, type: "job.error", payload: { message: `burst ${i}` } }));
        return out;
      });
      await waitFor(() => expect(fast).toEqual(rows.map((r) => r.id)));
      expect(dropped).toHaveBeenCalledExactlyOnceWith("slow");
    } finally {
      offSlow();
      offFast();
    }
  });
});

describe("SSE stream", () => {
  it("replays missed events after a reconnect with Last-Event-ID, then goes live, with no gaps or duplicates", async () => {
    const own = await newJob();
    const e: CrateEvent[] = [];
    for (let i = 1; i <= 3; i++) e.push(await emit(`e${i}`, own.id));

    const first = track(await openStream({ jobId: own.id }));
    expect(first.response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    await waitFor(() => expect(first.ids()).toEqual(e.map((r) => r.id)));
    await first.close();

    // Missed while disconnected.
    for (let i = 4; i <= 6; i++) e.push(await emit(`e${i}`, own.id));

    // Small pages, and writes racing the replay, to catch an event slipping between replay and live.
    const second = track(await openStream({ jobId: own.id, lastEventId: e[2]!.id, pageSize: 2 }));
    const racing = Promise.all([emit("e7", own.id), emit("e8", own.id)]);
    e.push(...(await racing));
    e.push(await emit("e9", own.id));

    const expected = e
      .slice(3)
      .map((r) => r.id)
      .sort((a, b) => a - b);
    await waitFor(() => expect(second.ids()).toEqual(expected));
    const jobMessages = second.messages.filter((m) => m.data.jobId !== null);
    expect(jobMessages.slice(0, 3).map((m) => m.data.payload.message)).toEqual(["e4", "e5", "e6"]);
    expect(jobMessages[0]?.data).toMatchObject({ id: e[3]!.id, jobId: own.id, type: "job.error" });
  });

  it("accepts ?lastEventId= when the header can't be set, and rejects a malformed one", async () => {
    const own = await newJob();
    const a = await emit("a", own.id);
    const b = await emit("b", own.id);
    const s = track(await openStream({ jobId: own.id, query: `&lastEventId=${a.id}` }));
    await waitFor(() => expect(s.ids()).toEqual([b.id]));
    const bad = await openStream({ jobId: own.id, lastEventId: "abc" });
    expect(bad.response.status).toBe(400);
  });

  it("sends org-wide events (engine.updated) on every job's stream of that org", async () => {
    const own = await newJob();
    const s = track(await openStream({ jobId: own.id }));
    const update = await inTransaction(t.db, (tx) => emitEvent(tx, DEFAULT_ORG, { jobId: null, type: "engine.updated", payload: { engineVersion: "2" } }));
    await waitFor(() => expect(s.messages.map((m) => m.data)).toContainEqual(expect.objectContaining({ id: update.id, jobId: null, type: "engine.updated" })));
  });

  it("refuses a job from another org before subscribing, and never streams another org's events", async () => {
    const [row] = await t.sql`insert into org (slug, name) values (${`other-${randomBytes(3).toString("hex")}`}, 'Other') returning id`;
    const other = orgContext(row!.id as string);
    const theirJob = await newJob(other);
    await emit("theirs", theirJob.id, other);

    const subscribe = vi.fn(bus.subscribe);
    const spyBus = { ...bus, subscribe };
    const refused = await openStream({ jobId: theirJob.id, bus: spyBus });
    expect(refused.response.status).toBe(404);
    const unknown = await openStream({ jobId: "00000000-0000-4000-8000-0000000000ff", bus: spyBus });
    expect(unknown.response.status).toBe(404);
    expect(subscribe).not.toHaveBeenCalled();

    // Their org-wide event doesn't reach our stream either.
    const own = await newJob();
    const s = track(await openStream({ jobId: own.id }));
    await inTransaction(t.db, (tx) => emitEvent(tx, other, { jobId: null, type: "engine.updated", payload: { engineVersion: "theirs" } }));
    const ours = await emit("ours", own.id);
    await waitFor(() => expect(s.ids()).toContain(ours.id));
    expect(s.messages.every((m) => m.data.jobId === own.id || m.data.payload.engineVersion !== "theirs")).toBe(true);
  });
});

describe("listener recovery", () => {
  it("comes back after its backend is killed (pg_terminate_backend), and streams resume with nothing lost", async () => {
    const own = await newJob();
    const s = track(await openStream({ jobId: own.id }));
    const before = await emit("before", own.id);
    await waitFor(() => expect(s.ids()).toEqual([before.id]));
    const reconnects = bus.status().reconnects;

    await t.sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = ${appName}`;
    // Written while the listener may be down: the resync after LISTEN returns reads it from the table.
    const during = await emit("during", own.id);
    await waitFor(() => expect(bus.status().reconnects).toBeGreaterThan(reconnects));
    const after = await emit("after", own.id);
    await waitFor(() => expect(s.ids()).toEqual([before.id, during.id, after.id]));
  });

  it("keeps retrying while Postgres refuses it, and resumes when it can connect again", async () => {
    // A login role of its own, so the listener can be locked out while the pool keeps working.
    const role = `crate_listener_${randomBytes(3).toString("hex")}`;
    const name = `${appName}-locked`;
    await t.sql.unsafe(`create role ${role} login password 'listener'`);
    const url = new URL(t.url);
    url.username = role;
    url.password = "listener";
    const locked = newBus(url.toString(), name);
    const admin = postgres(t.url, { max: 1, onnotice: () => {} });
    try {
      await locked.start();
      const own = await newJob();
      const s = track(await openStream({ jobId: own.id, bus: locked }));
      const first = await emit("first", own.id);
      await waitFor(() => expect(s.ids()).toEqual([first.id]));

      await admin.unsafe(`alter role ${role} nologin`);
      await admin`select pg_terminate_backend(pid) from pg_stat_activity where application_name = ${name}`;
      // postgres.js's own single re-LISTEN fails; the probe notices and the bus keeps retrying.
      await waitFor(() => expect(locked.status().listening).toBe(false));
      const missed = await emit("missed", own.id);
      expect(s.ids()).toEqual([first.id]);

      await admin.unsafe(`alter role ${role} login`);
      await waitFor(() => expect(locked.status().listening).toBe(true));
      const later = await emit("later", own.id);
      await waitFor(() => expect(s.ids()).toEqual([first.id, missed.id, later.id]));
    } finally {
      await locked.stop();
      await admin`select pg_terminate_backend(pid) from pg_stat_activity where usename = ${role}`;
      await admin.unsafe(`drop role if exists ${role}`);
      await admin.end({ timeout: 5 });
    }
  });
});

describe("liveness probe under overload", () => {
  it("doesn't count time spent waiting for a pool connection: a slow pool never reconnects a healthy listener", async () => {
    const { seen, log } = warnings();
    // Every probe NOTIFY waits 1.2 s for "a pool connection", three times the probe timeout.
    const slowPool = {
      ...t.system,
      notify: (channel: string, payload: string) => new Promise((r) => setTimeout(r, 1200)).then(() => t.system.notify(channel, payload)),
    };
    const slow = newBus(t.url, `${appName}-slow`, { system: slowPool, log });
    await slow.start();
    try {
      const own = await newJob();
      const s = track(await openStream({ jobId: own.id, bus: slow }));
      await new Promise((r) => setTimeout(r, 3000));
      expect(slow.status()).toMatchObject({ listening: true, reconnects: 0 });
      expect(seen.filter((m) => m.includes("probe"))).toEqual([]);
      const live = await emit("still live", own.id);
      await waitFor(() => expect(s.ids()).toEqual([live.id]));
    } finally {
      await slow.stop();
    }
  });

  it("reads a probe already on the socket before judging it, when the event loop was blocked past the deadline", async () => {
    const { seen, log } = warnings();
    let blocked = 0;
    const blocking = {
      ...t.system,
      notify: async (channel: string, payload: string) => {
        await t.system.notify(channel, payload);
        // The loop is stuck (CPU work) for longer than the probe timeout right after the NOTIFY:
        // the deadline and the notification are both pending when it frees up.
        if (blocked++ < 3) setImmediate(() => busyWait(700));
      },
    };
    const lagging = newBus(t.url, `${appName}-lag`, { system: blocking, log, probeIntervalMs: 1000 });
    await lagging.start();
    try {
      await waitFor(() => expect(blocked).toBeGreaterThanOrEqual(3), 10_000);
      await new Promise((r) => setTimeout(r, 1000));
      expect(seen.filter((m) => m.includes("probe"))).toEqual([]);
      expect(lagging.status()).toMatchObject({ listening: true, reconnects: 0 });
    } finally {
      await lagging.stop();
    }
  });

  it("reconnects once probeMisses probes in a row don't come back, and not after one", async () => {
    const { seen, log } = warnings();
    // NOTIFYs that commit but never reach the listener: what a half-open listen connection looks like.
    const lost = { ...t.system, notify: async () => {} };
    const deaf = newBus(t.url, `${appName}-deaf`, { system: lost, log, probeMisses: 2 });
    await deaf.start();
    try {
      await waitFor(() => expect(deaf.status().reconnects).toBeGreaterThan(0), 10_000);
      const lostAt = seen.findIndex((m) => m.includes("listener lost"));
      expect(seen.slice(0, lostAt)).toEqual([expect.stringMatching(/liveness probe missed .*1 of 2/)]);
      expect(seen[lostAt]).toMatch(/2 liveness probes missed in a row/);
    } finally {
      await deaf.stop();
    }
  });
});

describe("health metric", () => {
  it("reads the NOTIFY queue usage", async () => {
    const usage = await t.system.notificationQueueUsage();
    expect(usage).toBeGreaterThanOrEqual(0);
    expect(usage).toBeLessThan(0.5);
  });
});
