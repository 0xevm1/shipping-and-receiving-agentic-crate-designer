/**
 * Live events (#46 §3), for Route Handlers. Server-only: the bus holds a database connection.
 * docs/POSTGRES.md "Events" describes the channel, payload, limits and event types.
 */
import "server-only";
import { databaseUrl } from "@/server/db/config";
import { getSystemQueries } from "@/server/db/client";
import type { EventBus } from "./bus";
import { createPgEventBus } from "./pgEventBus";

export type { EventBus, EventBusStatus, Subscriber } from "./bus";
export { emitEvent, type EmitEventInput } from "./emit";
export { handleJobEventsRequest, type JobEventStreamDeps } from "./sse";
export { NOTIFY_QUEUE_ALERT_RATIO, readNotificationQueueUsage } from "./metrics";

// One bus (so one LISTEN connection) per process, kept on globalThis so dev-mode hot reloads
// reuse it rather than opening another listener each time.
const holder = globalThis as typeof globalThis & { __crateDesignerEventBus?: EventBus };

/** The process's event bus, started on first use (never at import, so `next build` needs no database). */
export function getEventBus(): EventBus {
  if (!holder.__crateDesignerEventBus) {
    const bus = createPgEventBus({ url: databaseUrl(), system: getSystemQueries() });
    holder.__crateDesignerEventBus = bus;
    void bus.start();
  }
  return holder.__crateDesignerEventBus;
}

/** The bus if something has started it, without starting one (health checks). */
export const peekEventBus = (): EventBus | undefined => holder.__crateDesignerEventBus;
