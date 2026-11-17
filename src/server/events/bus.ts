/**
 * The transport-neutral event bus (#46 §3). Producers write to the `event` table (`emitEvent`);
 * the bus only carries "something committed" to this process's subscribers. Postgres
 * LISTEN/NOTIFY is the implementation today (`pgEventBus.ts`); Redis Streams, NATS or Kafka can
 * replace it behind this interface without touching producers or the SSE route, because the
 * `event` table stays the source of truth and every subscriber re-reads from it.
 */
import type { SubscribeOptions, Subscriber } from "./hub";

export type { SubscribeOptions, Subscriber } from "./hub";

export type EventBusStatus = {
  /** LISTEN is registered and the last liveness probe (if any) came back. */
  listening: boolean;
  /** Times the listener came back after a drop. */
  reconnects: number;
  subscribers: number;
  /** Last `pg_notification_queue_usage()` reading (0–1), or null before the first probe. */
  notificationQueueUsage: number | null;
};

export interface EventBus {
  /** Starts listening. Resolves once LISTEN is registered, retrying with backoff until then (or `stop`). */
  start(): Promise<void>;
  /** Stops listening and drops every subscriber. */
  stop(): Promise<void>;
  /** Live notifications for `jobId` (and org-wide ones). Returns the unsubscribe function. */
  subscribe(jobId: string, subscriber: Subscriber, options?: SubscribeOptions): () => void;
  status(): EventBusStatus;
}
