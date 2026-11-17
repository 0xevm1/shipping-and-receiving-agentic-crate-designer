/**
 * In-process fan-out (#46 §3): maps job ids to subscribers. The listener calls `publish` for every
 * notification and never waits on a subscriber. Each subscriber gets its own bounded queue,
 * drained one delivery at a time; one that falls `maxBuffered` behind is dropped (its `onDrop`
 * runs) instead of holding memory or stalling the others. No database here, so it unit-tests
 * without Docker.
 */
import type { EventNotification } from "@/lib/events";

export type Subscriber = {
  /** A committed event for this job, or an org-wide one (`jobId` null). May return a promise. */
  onEvent(notification: EventNotification): void | Promise<void>;
  /** The listener reconnected, so notifications may have been missed: re-read from the table. */
  onResync?(): void | Promise<void>;
  /** Dropped for falling behind (or the bus stopped). No more calls follow. */
  onDrop?(reason: string): void;
};

export type SubscribeOptions = { maxBuffered?: number };
export const DEFAULT_MAX_BUFFERED = 256;

type Delivery = { kind: "event"; notification: EventNotification } | { kind: "resync" };

type Entry = {
  jobId: string;
  subscriber: Subscriber;
  maxBuffered: number;
  queue: Delivery[];
  draining: boolean;
  active: boolean;
};

export type EventHub = ReturnType<typeof createEventHub>;

export function createEventHub(log: Pick<Console, "warn" | "error"> = console) {
  const byJob = new Map<string, Set<Entry>>();
  let count = 0;

  function remove(entry: Entry): void {
    if (!entry.active) return;
    entry.active = false;
    entry.queue.length = 0;
    const set = byJob.get(entry.jobId);
    set?.delete(entry);
    if (set?.size === 0) byJob.delete(entry.jobId);
    count--;
  }

  function drop(entry: Entry, reason: string): void {
    if (!entry.active) return;
    remove(entry);
    try {
      entry.subscriber.onDrop?.(reason);
    } catch (err) {
      log.error("[events] onDrop threw", err);
    }
  }

  async function drain(entry: Entry): Promise<void> {
    entry.draining = true;
    while (entry.active && entry.queue.length > 0) {
      const next = entry.queue.shift()!;
      try {
        if (next.kind === "event") await entry.subscriber.onEvent(next.notification);
        else await entry.subscriber.onResync?.();
      } catch (err) {
        log.error("[events] subscriber failed; continuing", err);
      }
    }
    entry.draining = false;
  }

  function deliver(entry: Entry, delivery: Delivery): void {
    if (!entry.active) return;
    if (entry.queue.length >= entry.maxBuffered) {
      log.warn(`[events] dropping a slow subscriber of job ${entry.jobId} (${entry.queue.length} undelivered)`);
      drop(entry, "slow");
      return;
    }
    entry.queue.push(delivery);
    if (!entry.draining) void drain(entry);
  }

  return {
    subscribe(jobId: string, subscriber: Subscriber, options: SubscribeOptions = {}): () => void {
      const entry: Entry = {
        jobId,
        subscriber,
        maxBuffered: options.maxBuffered ?? DEFAULT_MAX_BUFFERED,
        queue: [],
        draining: false,
        active: true,
      };
      let set = byJob.get(jobId);
      if (!set) byJob.set(jobId, (set = new Set()));
      set.add(entry);
      count++;
      return () => remove(entry);
    },

    /** A job's event goes to that job's subscribers; an org-wide one (no job) to every subscriber. */
    publish(notification: EventNotification): void {
      if (notification.jobId === null) {
        for (const set of byJob.values()) for (const entry of set) deliver(entry, { kind: "event", notification });
        return;
      }
      for (const entry of byJob.get(notification.jobId) ?? []) deliver(entry, { kind: "event", notification });
    },

    resyncAll(): void {
      for (const set of byJob.values()) for (const entry of set) deliver(entry, { kind: "resync" });
    },

    dropAll(reason: string): void {
      for (const set of [...byJob.values()]) for (const entry of [...set]) drop(entry, reason);
    },

    get size(): number {
      return count;
    },
  };
}
