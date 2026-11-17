/**
 * Shared reads for a job's SSE streams (#46 §3, docs/LOAD_TEST.md "What limits it"). Without it,
 * one notification made every open stream of the job run its own `listForStream` query: one save
 * to a job watched by 50 tabs was 50 identical queries through the pool. A feed is the one bus
 * subscriber for an (org, job) in this process: on a notification it reads the job's new events
 * (and the org's job-less ones) once, encodes each as an SSE message once, and hands the same
 * batch to every stream of that job.
 *
 * A batch is `{ after, messages }`: every event of the stream with `after < id ≤ last id`, oldest
 * first, with nothing missing (event ids commit in order, `events.append`). A stream whose own
 * cursor is at or past `after` writes the messages it hasn't sent yet; one that is behind (still
 * replaying from its Last-Event-ID, or joined after the feed read past it) reads the table itself
 * from its cursor, exactly as before. So the no-gap, no-duplicate guarantees don't depend on the
 * feed: it only saves the reads of streams that are already caught up, which is nearly all of them.
 */
import type { JobEventMessage } from "@/lib/events";
import type { OrgContext } from "@/server/db/org";
import { requireOrg } from "@/server/db/org";
import type { CrateEvent, Repository } from "@/server/db/repository";
import type { EventBus } from "./bus";

/** One event, ready to write: its id and its whole SSE message, encoded once for every stream. */
type FeedMessage = { id: number; chunk: Uint8Array };
type FeedBatch = { after: number; messages: FeedMessage[] };

export type FeedListener = {
  onBatch(batch: FeedBatch): void;
  /** The listener reconnected, or the feed's read failed: read from your own cursor. */
  onResync(): void;
  /** The bus dropped the feed (it stopped, or the feed fell behind): close the stream. */
  onDrop(reason: string): void;
};

export type FeedOptions = {
  ctx: OrgContext;
  repo: Pick<Repository, "events">;
  /** Rows per read. */
  pageSize: number;
  log: Pick<Console, "warn" | "error">;
};

function toMessage(row: CrateEvent): JobEventMessage {
  return {
    id: row.id,
    jobId: row.jobId,
    type: row.type as JobEventMessage["type"],
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

const encoder = new TextEncoder();

/** The SSE message for an event; its `id:` is what the browser sends back as `Last-Event-ID`. */
export const sseMessage = (row: CrateEvent): string => `id: ${row.id}\ndata: ${JSON.stringify(toMessage(row))}\n\n`;
const encodeMessage = (row: CrateEvent): FeedMessage => ({ id: row.id, chunk: encoder.encode(sseMessage(row)) });

type Feed = { listeners: Set<FeedListener>; unsubscribe: () => void };

// Feeds per bus (tests run several buses in one process), then per org and job.
const feedsByBus = new WeakMap<object, Map<string, Feed>>();

/**
 * Adds `listener` to the feed of `jobId` (creating it, and its one bus subscription, on first
 * use). Returns the function that removes it; the last one out unsubscribes the feed.
 */
export function joinJobFeed(bus: Pick<EventBus, "subscribe">, jobId: string, listener: FeedListener, options: FeedOptions): () => void {
  const orgId = requireOrg(options.ctx);
  const feeds = feedsByBus.get(bus) ?? new Map<string, Feed>();
  feedsByBus.set(bus, feeds);
  const key = `${orgId}:${jobId}`;
  let feed = feeds.get(key);
  if (!feed) {
    feed = openFeed(bus, jobId, orgId, options, () => feeds.delete(key));
    feeds.set(key, feed);
  }
  const joined = feed;
  joined.listeners.add(listener);
  return () => {
    if (!joined.listeners.delete(listener) || joined.listeners.size > 0) return;
    joined.unsubscribe();
    if (feeds.get(key) === joined) feeds.delete(key);
  };
}

function openFeed(bus: Pick<EventBus, "subscribe">, jobId: string, orgId: string, options: FeedOptions, forget: () => void): Feed {
  const { ctx, repo, pageSize, log } = options;
  const listeners = new Set<FeedListener>();
  /** The last event id read; null until the first notification (streams replay on their own). */
  let cursor: number | null = null;
  let reading = false;
  let again = false;

  const each = (fn: (l: FeedListener) => void) => {
    for (const l of [...listeners]) {
      try {
        fn(l);
      } catch (err) {
        log.error("[events] a stream's feed listener threw; continuing", err);
      }
    }
  };

  async function read(): Promise<void> {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      do {
        again = false;
        for (;;) {
          const after = cursor!;
          const rows = await repo.events.listForStream(ctx, jobId, after, pageSize);
          if (rows.length === 0) break;
          cursor = rows[rows.length - 1]!.id;
          const batch: FeedBatch = { after, messages: rows.map(encodeMessage) };
          each((l) => l.onBatch(batch));
          if (rows.length < pageSize) break;
        }
      } while (again && listeners.size > 0);
    } catch (err) {
      // Each stream reads for itself instead; one that fails too closes, and its browser resumes.
      log.error(`[events] reading events for job ${jobId} failed; its streams read on their own`, err);
      cursor = null;
      each((l) => l.onResync());
    } finally {
      reading = false;
    }
  }

  const unsubscribe = bus.subscribe(jobId, {
    onEvent(n) {
      if (n.orgId !== orgId) return;
      if (cursor === null) cursor = n.id - 1;
      else if (n.id <= cursor) return;
      void read();
    },
    onResync() {
      // Notifications were lost while the listener was down. Each stream reads from its own
      // cursor; the feed starts again from the next notification.
      cursor = null;
      each((l) => l.onResync());
    },
    onDrop(reason) {
      forget();
      each((l) => l.onDrop(reason));
      listeners.clear();
    },
  });

  return { listeners, unsubscribe };
}
