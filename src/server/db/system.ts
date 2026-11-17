/**
 * Server-level queries that read no org data, so they need no `OrgContext`: the health ping, the
 * NOTIFY queue gauge and the event bus's liveness probe. Anything that touches a table belongs in
 * the org-scoped repository instead.
 */
import { sql } from "drizzle-orm";
import type { Database } from "./repository";

export function createSystemQueries(db: Database) {
  return {
    /** Round trip to the database; throws when it's unreachable. */
    async ping(): Promise<void> {
      await db.execute(sql`select 1`);
    },
    /**
     * Fraction (0–1) of the server-wide NOTIFY queue in use. A listener that stops reading holds
     * the queue; when it fills, every NOTIFY (so every event write) fails. Alert at 0.5.
     */
    async notificationQueueUsage(): Promise<number> {
      const rows = await db.execute<{ usage: number }>(sql`select pg_notification_queue_usage()::float8 as usage`);
      return Number(rows[0]?.usage ?? 0);
    },
    /** `pg_notify` outside any transaction (the event bus's self-probe). */
    async notify(channel: string, payload: string): Promise<void> {
      await db.execute(sql`select pg_notify(${channel}, ${payload})`);
    },
  };
}

export type SystemQueries = ReturnType<typeof createSystemQueries>;
