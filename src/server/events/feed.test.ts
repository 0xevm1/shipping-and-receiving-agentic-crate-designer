// The shared fan-out read (feed.ts) and the SSE streams on top of it, with an in-memory event
// table and the real hub as the bus: no database. The same guarantees against Postgres are in
// events.integration.test.ts.
import { describe, expect, it } from "vitest";
import type { EventNotification } from "@/lib/events";
import { DEFAULT_ORG, orgContext } from "@/server/db/org";
import type { CrateEvent } from "@/server/db/repository";
import { createEventHub } from "./hub";
import { handleJobEventsRequest } from "./sse";

const ORG = DEFAULT_ORG.orgId;
const OTHER = "00000000-0000-4000-8000-0000000000ee";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const quiet = { warn: () => {}, error: () => {} };
/** Lets every pending read, delivery and stream write run. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

/** An `event` table, a repo reading it the way `listForStream` does (counted), and a bus. */
function world() {
  const rows: CrateEvent[] = [];
  const hub = createEventHub(quiet);
  const reads: { jobId: string; after: number }[] = [];
  let failNext = false;
  const repo = {
    jobs: { get: async (_ctx: unknown, id: string) => ({ id }) },
    events: {
      listForStream: async (ctx: { orgId: string }, jobId: string, after = 0, limit = 500) => {
        reads.push({ jobId, after });
        await Promise.resolve();
        if (failNext) {
          failNext = false;
          throw new Error("connection lost");
        }
        return rows.filter((r) => r.orgId === ctx.orgId && (r.jobId === jobId || r.jobId === null) && r.id > after).slice(0, limit);
      },
    },
  };
  /** Commits an event (ids in commit order) and, unless `silent`, notifies. */
  function commit(jobId: string | null, orgId = ORG, { silent = false } = {}): CrateEvent {
    const row = { id: rows.length + 1, orgId, jobId, type: "job.error", payload: { message: `e${rows.length + 1}` }, createdAt: new Date(0) } as CrateEvent;
    rows.push(row);
    if (!silent) hub.publish({ id: row.id, orgId, jobId, type: row.type } satisfies EventNotification);
    return row;
  }
  async function open(jobId: string, lastEventId?: number, opts: { ctx?: typeof DEFAULT_ORG; pageSize?: number } = {}) {
    const abort = new AbortController();
    const headers = lastEventId === undefined ? undefined : { "Last-Event-ID": String(lastEventId) };
    const res = await handleJobEventsRequest(new Request(`http://test/api/v1/events?job=${jobId}`, { headers, signal: abort.signal }), {
      ctx: opts.ctx ?? DEFAULT_ORG,
      repo: repo as never,
      bus: hub,
      heartbeatMs: 60_000,
      pageSize: opts.pageSize,
      log: quiet,
    });
    const ids: number[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (const m of buffer.matchAll(/^id: (\d+)$/gm)) ids.push(Number(m[1]));
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      }
    })();
    return { ids, close: () => abort.abort() };
  }
  return { rows, hub, reads, repo, commit, open, failOnce: () => (failNext = true) };
}

describe("job feed", () => {
  it("reads a notification's rows once for every stream of the job, not once per stream", async () => {
    const w = world();
    const streams = await Promise.all(Array.from({ length: 50 }, () => w.open(A, 0)));
    const other = await w.open(B, 0);
    await settle();
    w.reads.length = 0;

    const e = w.commit(A);
    await settle();
    expect(w.reads).toEqual([{ jobId: A, after: e.id - 1 }]);
    for (const s of streams) expect(s.ids).toEqual([e.id]);
    expect(other.ids).toEqual([]);
    expect(w.hub.size).toBe(2); // One bus subscriber per job, however many streams.

    // A burst of saves coalesces too.
    w.reads.length = 0;
    const burst = [w.commit(A), w.commit(A), w.commit(A)];
    await settle();
    expect(w.reads.length).toBeLessThanOrEqual(2);
    for (const s of streams) expect(s.ids).toEqual([e.id, ...burst.map((r) => r.id)]);
  });

  it("reads an org-wide event once per job, and sends it on every job's streams", async () => {
    const w = world();
    const a = await Promise.all([w.open(A, 0), w.open(A, 0)]);
    const b = await Promise.all([w.open(B, 0), w.open(B, 0)]);
    await settle();
    w.reads.length = 0;
    const update = w.commit(null);
    await settle();
    expect(w.reads.map((r) => r.jobId).sort()).toEqual([A, B]);
    for (const s of [...a, ...b]) expect(s.ids).toEqual([update.id]);
    // Another org's event reaches neither feed.
    w.reads.length = 0;
    w.commit(null, OTHER);
    await settle();
    expect(w.reads).toEqual([]);
  });

  it("keeps each stream's own cursor: a stream behind the batch reads the gap itself, with no duplicates", async () => {
    const w = world();
    const live = await w.open(A, 0);
    const first = w.commit(A);
    await settle();
    expect(live.ids).toEqual([first.id]);

    // Committed with nobody notified (as if before this stream's replay), then a stream resuming
    // from 0 joins while the feed is already past them.
    const quiet1 = w.commit(A, ORG, { silent: true });
    const next = w.commit(A);
    await settle();
    const late = await w.open(A, 0, { pageSize: 1 });
    const after = [w.commit(A), w.commit(A)];
    await settle();
    const all = [first, quiet1, next, ...after].map((r) => r.id);
    expect(late.ids).toEqual(all);
    expect(live.ids).toEqual(all);
  });

  it("tells streams to read for themselves after a resync, and after a failed shared read", async () => {
    const w = world();
    const s = await w.open(A, 0);
    await settle();
    const missed = w.commit(A, ORG, { silent: true });
    w.hub.resyncAll();
    await settle();
    expect(s.ids).toEqual([missed.id]);

    w.failOnce();
    const e = w.commit(A);
    await settle();
    expect(s.ids).toEqual([missed.id, e.id]);
    const later = w.commit(A);
    await settle();
    expect(s.ids).toEqual([missed.id, e.id, later.id]);
  });

  it("unsubscribes the job's feed when its last stream closes, and keeps orgs apart", async () => {
    const w = world();
    const one = await w.open(A, 0);
    const two = await w.open(A, 0);
    const theirs = await w.open(A, 0, { ctx: orgContext(OTHER) });
    await settle();
    expect(w.hub.size).toBe(2); // Our feed and theirs.
    w.commit(A, OTHER);
    await settle();
    expect(one.ids).toEqual([]);
    expect(theirs.ids).toEqual([1]);
    one.close();
    two.close();
    theirs.close();
    await settle();
    expect(w.hub.size).toBe(0);
  });
});
