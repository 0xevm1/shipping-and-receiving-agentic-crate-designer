/**
 * Postgres LISTEN/NOTIFY implementation of `EventBus` (#46 §3).
 *
 * One dedicated session connection per process, never from the pool: LISTEN is session state, so
 * it can't go through the pool (or PgBouncer in transaction mode). It uses postgres.js
 * `sql.listen` on a client of its own, which opens exactly one connection for listening.
 *
 * Reconnecting: postgres.js re-issues LISTEN once when that connection closes, and calls
 * `onlisten` again when it succeeds. If that one attempt fails (Postgres still restarting), it
 * gives up silently. So the bus also probes itself: every `probeIntervalMs` it NOTIFYs a probe
 * token through the pool and expects it back on the listen connection. `probeMisses` probes in a
 * row that don't come back (or whose NOTIFY fails) mean the listener is dead or half-open: the
 * bus closes that client and opens a new one, retrying with capped exponential backoff and jitter.
 *
 * The probe must not misfire when the process is merely overloaded (docs/LOAD_TEST.md): tearing
 * down a healthy listener makes every stream resync, at the worst moment. So the `probeTimeoutMs`
 * clock starts only once the NOTIFY has committed (time spent waiting for a pool connection says
 * nothing about the listener); the verdict is taken in a `setImmediate` after the timer, so a
 * notification already waiting on the socket of a lagging event loop is read first; and one miss
 * alone never reconnects.
 *
 * Every LISTEN after the first tells all subscribers to resync, because NOTIFYs sent while
 * nobody was listening are gone; subscribers re-read the `event` table from their cursor.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { CRATE_EVENTS_CHANNEL, EventNotificationSchema } from "@/lib/events";
import type { SystemQueries } from "@/server/db/system";
import type { EventBus, EventBusStatus } from "./bus";
import { createEventHub, type SubscribeOptions, type Subscriber } from "./hub";
import { readNotificationQueueUsage } from "./metrics";

export type PgEventBusOptions = {
  url: string;
  /** Pooled queries for the probe NOTIFY and the queue gauge. */
  system: Pick<SystemQueries, "notify" | "notificationQueueUsage">;
  probeIntervalMs?: number;
  /** How long a committed probe NOTIFY may take to come back before it counts as a miss. */
  probeTimeoutMs?: number;
  /** Misses in a row that mean the listener is gone (default 2). */
  probeMisses?: number;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  /** Shown in `pg_stat_activity.application_name`, to find (or kill) the listen connection. */
  applicationName?: string;
  log?: Pick<Console, "info" | "warn" | "error">;
};

export const LISTENER_APPLICATION_NAME = "crate-events-listener";

/** A probe in flight. `timer` (the deadline) is set once its NOTIFY has committed. */
type Probe = { token: string; startedAt: number; received: boolean; timer?: ReturnType<typeof setTimeout> };

/** A readable reason for any thrown value: `message`, else `code`, else the nested errors' (an `AggregateError` from a refused dual-stack connect has an empty message). */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [];
  if (err.message) parts.push(err.message);
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && !err.message.includes(code)) parts.push(code);
  if (err instanceof AggregateError && err.errors.length) parts.push(err.errors.map(describeError).join("; "));
  return parts.join(": ") || err.name || "unknown error";
}

/** Full-jitter exponential backoff: `initial · 2^attempt`, capped, times a random 0.5–1. */
export function backoffDelay(attempt: number, initialMs: number, maxMs: number, random = Math.random): number {
  return Math.min(maxMs, initialMs * 2 ** attempt) * (0.5 + random() / 2);
}

export function createPgEventBus(options: PgEventBusOptions): EventBus {
  const {
    url,
    system,
    probeIntervalMs = 15_000,
    probeTimeoutMs = 5_000,
    probeMisses = 2,
    backoffInitialMs = 250,
    backoffMaxMs = 10_000,
    applicationName = LISTENER_APPLICATION_NAME,
    log = console,
  } = options;
  const busId = randomUUID();
  const hub = createEventHub(log);

  let running = false;
  let client: postgres.Sql | undefined;
  let connecting: Promise<void> | undefined;
  let listening = false;
  let listenedOnce = false;
  let reconnects = 0;
  let queueUsage: number | null = null;
  let probeSeq = 0;
  let probe: Probe | undefined;
  let misses = 0;
  let probeTimer: ReturnType<typeof setInterval> | undefined;
  let wake: (() => void) | undefined;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref?.();
      function done() {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      }
      wake = done;
    });
  }

  function onNotify(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      log.warn("[events] ignoring a non-JSON notification");
      return;
    }
    if (json && typeof json === "object" && "probe" in json) {
      if (probe && (json as { probe: unknown }).probe === probe.token) {
        // Possibly before the NOTIFY's own promise resolves: `sendProbe` checks `received`.
        probe.received = true;
        misses = 0;
        if (probe.timer) {
          clearTimeout(probe.timer);
          probe = undefined;
        }
      }
      return; // Another instance's probe, or a late one of ours.
    }
    const parsed = EventNotificationSchema.safeParse(json);
    if (!parsed.success) {
      log.warn("[events] ignoring a malformed notification");
      return;
    }
    hub.publish(parsed.data);
  }

  function onListen(): void {
    listening = true;
    if (listenedOnce) {
      reconnects++;
      log.info(`[events] LISTEN ${CRATE_EVENTS_CHANNEL} restored; subscribers resync from the event table`);
      hub.resyncAll();
    }
    listenedOnce = true;
  }

  async function closeClient(): Promise<void> {
    const old = client;
    client = undefined;
    listening = false;
    await old?.end({ timeout: 0 }).catch(() => {});
  }

  /** Opens a client and LISTENs, retrying with backoff until it works or the bus stops. */
  function connect(): Promise<void> {
    connecting ??= (async () => {
      for (let attempt = 0; running; attempt++) {
        const next = postgres(url, {
          max: 1,
          idle_timeout: 0,
          max_lifetime: null,
          connect_timeout: 10,
          fetch_types: false,
          onnotice: () => {},
          connection: { application_name: applicationName },
        });
        try {
          await next.listen(CRATE_EVENTS_CHANNEL, onNotify, onListen);
          if (!running) {
            await next.end({ timeout: 0 });
            return;
          }
          client = next;
          return;
        } catch (err) {
          await next.end({ timeout: 0 }).catch(() => {});
          const delay = backoffDelay(attempt, backoffInitialMs, backoffMaxMs);
          log.warn(`[events] LISTEN failed (${describeError(err)}); retrying in ${Math.round(delay)} ms`);
          await sleep(delay);
        }
      }
    })().finally(() => {
      connecting = undefined;
    });
    return connecting;
  }

  async function restart(reason: string): Promise<void> {
    if (!running || connecting) return;
    log.warn(`[events] listener lost (${reason}); reconnecting`);
    if (probe?.timer) clearTimeout(probe.timer);
    probe = undefined;
    misses = 0;
    await closeClient();
    await connect();
  }

  /** A probe that didn't come back (or couldn't be sent). Reconnects after `probeMisses` in a row. */
  function missed(reason: string): void {
    probe = undefined;
    if (++misses < probeMisses) {
      log.warn(`[events] liveness probe missed (${reason}); ${misses} of ${probeMisses} before reconnecting`);
      return;
    }
    void restart(`${misses} liveness probes missed in a row; last: ${reason}`);
  }

  function sendProbe(): void {
    if (!running || connecting || !client) return;
    // A NOTIFY still waiting for a pool connection is no evidence either way; a very old one is
    // abandoned (not counted) so probing doesn't stop for good.
    if (probe && (probe.timer || performance.now() - probe.startedAt < 4 * probeIntervalMs)) return;
    const token = `${busId}:${++probeSeq}`;
    const current: Probe = { token, startedAt: performance.now(), received: false };
    probe = current;
    system.notify(CRATE_EVENTS_CHANNEL, JSON.stringify({ probe: token })).then(
      () => {
        if (probe !== current) return;
        if (current.received) {
          probe = undefined;
          return;
        }
        // The deadline runs from the commit, not from when the NOTIFY was queued for the pool.
        current.timer = setTimeout(() => {
          // After pending I/O: a notification already on the socket of a busy loop is read first.
          setImmediate(() => {
            if (probe === current && !current.received) missed(`no probe back within ${probeTimeoutMs} ms of its NOTIFY`);
          });
        }, probeTimeoutMs);
        current.timer.unref?.();
      },
      (err: unknown) => {
        if (probe === current) missed(`probe NOTIFY failed: ${describeError(err)}`);
      },
    );
    readNotificationQueueUsage(system, log).then(
      (r) => (queueUsage = r.usage),
      () => {},
    );
  }

  return {
    async start() {
      if (running) return connecting;
      running = true;
      probeTimer = setInterval(sendProbe, probeIntervalMs);
      probeTimer.unref?.();
      await connect();
    },

    async stop() {
      running = false;
      clearInterval(probeTimer);
      if (probe?.timer) clearTimeout(probe.timer);
      probe = undefined;
      wake?.();
      await connecting;
      await closeClient();
      hub.dropAll("stopped");
    },

    subscribe(jobId: string, subscriber: Subscriber, subscribeOptions?: SubscribeOptions) {
      return hub.subscribe(jobId, subscriber, subscribeOptions);
    },

    status(): EventBusStatus {
      return { listening: listening && !!client, reconnects, subscribers: hub.size, notificationQueueUsage: queueUsage };
    },
  };
}
