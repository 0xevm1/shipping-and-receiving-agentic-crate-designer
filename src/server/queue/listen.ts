/**
 * `LISTEN crate_jobs` for the queue runner (#46 slice 7). One dedicated session connection (LISTEN
 * can't go through the pool). postgres.js re-issues LISTEN once after a dropped connection; if that
 * fails too the runner still polls, so a lost listener only costs latency, never a job.
 */
import postgres from "postgres";
import { QUEUE_CHANNEL } from "../db/queue";
import type { QueueListen } from "./runner";

export const QUEUE_LISTENER_APPLICATION_NAME = "crate-queue-listener";

export function pgQueueListen(url: string): QueueListen {
  return async (onWake) => {
    const client = postgres(url, {
      max: 1,
      idle_timeout: 0,
      max_lifetime: null,
      fetch_types: false,
      onnotice: () => {},
      connection: { application_name: QUEUE_LISTENER_APPLICATION_NAME },
    });
    try {
      await client.listen(QUEUE_CHANNEL, () => onWake());
    } catch (e) {
      await client.end({ timeout: 0 }).catch(() => {});
      throw e;
    }
    return () => client.end({ timeout: 1 });
  };
}
