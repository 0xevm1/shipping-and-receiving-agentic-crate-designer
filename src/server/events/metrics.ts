/** The NOTIFY queue gauge (#46 §3 "LISTEN/NOTIFY limits"). */
import type { SystemQueries } from "@/server/db/system";

/** Warn at half full: when the queue fills, every NOTIFY, and so every event write, fails. */
export const NOTIFY_QUEUE_ALERT_RATIO = 0.5;

/** Reads `pg_notification_queue_usage()` (0–1) and logs a warning at or above the alert ratio. */
export async function readNotificationQueueUsage(
  system: Pick<SystemQueries, "notificationQueueUsage">,
  log: Pick<Console, "warn"> = console,
): Promise<{ usage: number; alert: boolean }> {
  const usage = await system.notificationQueueUsage();
  const alert = usage >= NOTIFY_QUEUE_ALERT_RATIO;
  if (alert) {
    log.warn(
      `[events] NOTIFY queue ${(usage * 100).toFixed(1)}% full (alert at ${NOTIFY_QUEUE_ALERT_RATIO * 100}%): a listener has stopped reading; at 100% every event write fails`,
    );
  }
  return { usage, alert };
}
