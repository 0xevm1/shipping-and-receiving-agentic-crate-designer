/**
 * `GET /api/v1/health` (#46): is the server usable right now? The offline queue (slice 7a) uses
 * it as a liveness check, alongside the SSE stream being open.
 */
import type { SystemQueries } from "@/server/db/system";
import type { EventBusStatus } from "@/server/events/bus";
import { readNotificationQueueUsage } from "@/server/events/metrics";

export type Health = {
  ok: boolean;
  db: { ok: boolean; latencyMs: number | null };
  /** `pg_notification_queue_usage()`, 0–1; `alert` at 50 % or more. Null when the db is down. */
  notificationQueue: { usage: number; alert: boolean } | null;
  /** This process's listener, or null if nothing has subscribed yet. */
  events: EventBusStatus | null;
};

const DB_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

export async function checkHealth(system: Pick<SystemQueries, "ping" | "notificationQueueUsage">, bus?: { status(): EventBusStatus }): Promise<Health> {
  const events = bus?.status() ?? null;
  const started = performance.now();
  try {
    await withTimeout(system.ping(), DB_TIMEOUT_MS);
    const latencyMs = Math.round(performance.now() - started);
    const notificationQueue = await withTimeout(readNotificationQueueUsage(system), DB_TIMEOUT_MS);
    return { ok: true, db: { ok: true, latencyMs }, notificationQueue, events };
  } catch {
    return { ok: false, db: { ok: false, latencyMs: null }, notificationQueue: null, events };
  }
}
