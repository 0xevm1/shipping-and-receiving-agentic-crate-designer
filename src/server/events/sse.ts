/**
 * `GET /api/v1/events?job=…` (#46 §3): a job's events as Server-Sent Events.
 *
 * The stream is driven by a cursor, the id of the last event sent. Each SSE message carries that
 * id (`id:`), so the browser's automatic reconnect sends it back as `Last-Event-ID` (or, for a
 * polyfill that can't set headers, `?lastEventId=`). Order of work, so nothing is missed or sent
 * twice:
 *
 *   1. Check the job belongs to the caller's org (404 otherwise), before subscribing.
 *   2. Subscribe to the bus first, so a commit during the replay still wakes the stream.
 *   3. Replay `id > cursor` from the `event` table, in pages, advancing the cursor.
 *   4. Live: a notification with `id > cursor` (or a resync after the listener reconnected)
 *      reads the table again from the cursor. Notifications only wake the stream; the rows,
 *      payloads included, always come from the table, so replay and live are one code path.
 *
 * The cursor works because `events.append` makes event ids commit in order. A heartbeat comment
 * every `heartbeatMs` keeps proxies from closing an idle stream. A client that stops reading is
 * dropped once `maxQueuedChunks` messages pile up; it reconnects and replays from its last id.
 */
import type { JobEventMessage } from "@/lib/events";
import { type OrgContext, requireOrg } from "@/server/db/org";
import type { CrateEvent, Repository } from "@/server/db/repository";
import type { EventBus } from "./bus";

export type JobEventStreamDeps = {
  /** The caller's org, already authorised. */
  ctx: OrgContext;
  repo: Pick<Repository, "jobs" | "events">;
  bus: Pick<EventBus, "subscribe">;
  heartbeatMs?: number;
  /** Rows per replay query. */
  pageSize?: number;
  /** Unread messages tolerated before a slow client is cut off. */
  maxQueuedChunks?: number;
  /** The SSE `retry:` the browser waits before reconnecting, in ms. */
  retryMs?: number;
  log?: Pick<Console, "warn" | "error">;
};

export const SSE_HEARTBEAT_MS = 15_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const problem = (status: number, detail: string) => Response.json({ error: detail }, { status, headers: { "Cache-Control": "no-store" } });

/** `Last-Event-ID` header, else `?lastEventId=`. 0 when absent; null when malformed. */
export function readLastEventId(request: Request, url: URL): number | null {
  const raw = request.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
  if (raw === null || raw.trim() === "") return 0;
  if (!/^\d+$/.test(raw.trim())) return null;
  const id = Number(raw.trim());
  return Number.isSafeInteger(id) ? id : null;
}

export function toMessage(row: CrateEvent): JobEventMessage {
  return {
    id: row.id,
    jobId: row.jobId,
    type: row.type as JobEventMessage["type"],
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function handleJobEventsRequest(request: Request, deps: JobEventStreamDeps): Promise<Response> {
  const { ctx, repo, bus, heartbeatMs = SSE_HEARTBEAT_MS, pageSize = 500, maxQueuedChunks = 1000, retryMs = 2000, log = console } = deps;
  const orgId = requireOrg(ctx);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job");
  if (!jobId || !UUID.test(jobId)) return problem(400, "Query parameter `job` must be a job id.");
  const lastEventId = readLastEventId(request, url);
  if (lastEventId === null) return problem(400, "Last-Event-ID must be a non-negative integer.");

  // The org check, before anything subscribes. Another org's job looks exactly like a missing one.
  const job = await repo.jobs.get(ctx, jobId);
  if (!job) return problem(404, "No such job.");
  const streamJobId = job.id;

  const encoder = new TextEncoder();
  let cursor = lastEventId;
  let closed = false;
  let catchingUp: Promise<void> | undefined;
  let again = false;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  function close(): void {
    if (closed) return;
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    request.signal.removeEventListener("abort", close);
    try {
      controller.close();
    } catch {
      // Already closed or cancelled.
    }
  }

  function write(text: string): void {
    if (closed) return;
    controller.enqueue(encoder.encode(text));
    if ((controller.desiredSize ?? 0) < -maxQueuedChunks) {
      log.warn(`[events] closing a slow SSE client of job ${jobId}; it resumes from event ${cursor}`);
      close();
    }
  }

  /** Sends every event after the cursor. Concurrent calls coalesce into one more pass. */
  function catchUp(): Promise<void> {
    if (catchingUp) {
      again = true;
      return catchingUp;
    }
    catchingUp = (async () => {
      try {
        do {
          again = false;
          for (;;) {
            const rows = await repo.events.listForStream(ctx, streamJobId, cursor, pageSize);
            for (const row of rows) {
              if (closed) return;
              write(`id: ${row.id}\ndata: ${JSON.stringify(toMessage(row))}\n\n`);
              cursor = row.id;
            }
            if (rows.length < pageSize) break;
          }
        } while (again && !closed);
      } catch (err) {
        // Close; the browser reconnects with Last-Event-ID and the replay picks up from there.
        log.error(`[events] reading events for job ${jobId} failed; closing the stream`, err);
        close();
      } finally {
        catchingUp = undefined;
      }
    })();
    return catchingUp;
  }

  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
        if (request.signal.aborted) return close();
        request.signal.addEventListener("abort", close);
        // `retry:` sets the reconnect delay; it also sends the headers straight away.
        write(`retry: ${retryMs}\n\n`);
        unsubscribe = bus.subscribe(streamJobId, {
          onEvent(n) {
            if (n.orgId !== orgId || n.id <= cursor) return;
            void catchUp();
          },
          onResync() {
            void catchUp();
          },
          onDrop: close,
        });
        heartbeat = setInterval(() => write(": heartbeat\n\n"), heartbeatMs);
        heartbeat.unref?.();
        void catchUp();
      },
      cancel: close,
    },
    { highWaterMark: 1 },
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Tells nginx-style proxies not to buffer the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
