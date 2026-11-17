/**
 * The job queue's queries (#46 slice 7, docs/QUEUE.md). Enqueueing and reading a job are org-scoped
 * (they take an `OrgContext`, like the repository). Claiming is not: a queue worker serves every
 * org, so `claim` reads the queue table alone and hands back the row, whose `orgId` the runner turns
 * into the `OrgContext` the job's handler runs under. Nothing here reads another table.
 */
import { and, eq, sql } from "drizzle-orm";
import { type OrgContext, requireOrg } from "./org";
import type { Database, Transaction } from "./repository";
import { queueJob } from "./schema";

type Executor = Database | Transaction;

export type QueueJob = typeof queueJob.$inferSelect;

/** The channel `enqueue` NOTIFYs (on commit) so idle workers claim at once instead of at their next poll. */
export const QUEUE_CHANNEL = "crate_jobs";

/** Retry delay after failed attempt `n` (1-based): `baseMs · 2^(n−1)`, capped at `maxMs`. */
export const QUEUE_BACKOFF = { baseMs: 1_000, maxMs: 5 * 60_000 } as const;
export const DEFAULT_MAX_ATTEMPTS = 5;

export interface EnqueueInput {
  kind: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  /** One queued-or-running job per (org, kind, key): a second enqueue returns the first. */
  dedupeKey?: string;
  /** Not before this time (default: now). */
  runAt?: Date;
}

export function createQueueStore(db: Executor) {
  return {
    /**
     * Adds a job and NOTIFYs `crate_jobs`. Inside a caller's transaction (pass the transaction to
     * `createQueueStore`) both commit with the caller's change, or neither does.
     * Returns the job and whether it is new (false: a job with the same dedupe key is pending).
     */
    async enqueue(ctx: OrgContext, input: EnqueueInput): Promise<{ job: QueueJob; created: boolean }> {
      const orgId = requireOrg(ctx);
      const values = {
        orgId,
        kind: input.kind,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        dedupeKey: input.dedupeKey ?? null,
        ...(input.runAt ? { runAt: input.runAt } : {}),
      };
      const [inserted] = await db.insert(queueJob).values(values).onConflictDoNothing().returning();
      if (inserted) {
        await db.execute(sql`select pg_notify(${QUEUE_CHANNEL}, ${inserted.id})`);
        return { job: inserted, created: true };
      }
      const [pending] = await db
        .select()
        .from(queueJob)
        .where(
          and(
            eq(queueJob.orgId, orgId),
            eq(queueJob.kind, input.kind),
            eq(queueJob.dedupeKey, input.dedupeKey ?? ""),
            sql`${queueJob.status} in ('queued', 'running')`,
          ),
        );
      if (!pending) throw new Error("Enqueue conflicted, but no pending job holds the dedupe key.");
      return { job: pending, created: false };
    },

    async get(ctx: OrgContext, id: string): Promise<QueueJob | undefined> {
      const orgId = requireOrg(ctx);
      const [row] = await db
        .select()
        .from(queueJob)
        .where(and(eq(queueJob.orgId, orgId), eq(queueJob.id, id)));
      return row;
    },

    /**
     * Claims the oldest due job, or none: a queued job whose `run_at` has come, or a running one
     * whose lease ran out (its worker died). `FOR UPDATE SKIP LOCKED` lets any number of workers
     * claim at once without waiting on, or ever both taking, the same row. The claim leases the
     * row to `workerId` for `leaseMs` and counts the attempt.
     */
    async claim(workerId: string, leaseMs: number, kinds?: readonly string[]): Promise<QueueJob | undefined> {
      const kindFilter = kinds?.length
        ? sql`and kind in (${sql.join(
            kinds.map((k) => sql`${k}`),
            sql`, `,
          )})`
        : sql``;
      const [row] = await db
        .update(queueJob)
        .set({
          status: "running",
          attempts: sql`${queueJob.attempts} + 1`,
          lockedBy: workerId,
          lockedUntil: sql`now() + ${leaseMs} * interval '1 millisecond'`,
          updatedAt: sql`now()`,
        })
        .where(
          eq(
            queueJob.id,
            sql`(
              select id from queue_job
              where ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now())) ${kindFilter}
              order by run_at, created_at
              limit 1
              for update skip locked
            )`,
          ),
        )
        .returning();
      return row;
    },

    /** Renews `workerId`'s lease. False when the job is no longer this worker's (lease lost). */
    async extend(id: string, workerId: string, leaseMs: number): Promise<boolean> {
      const rows = await db
        .update(queueJob)
        .set({ lockedUntil: sql`now() + ${leaseMs} * interval '1 millisecond'`, updatedAt: sql`now()` })
        .where(and(eq(queueJob.id, id), eq(queueJob.lockedBy, workerId), eq(queueJob.status, "running")))
        .returning({ id: queueJob.id });
      return rows.length > 0;
    },

    /** Marks the job done. False when the lease was lost (another worker has it): nothing changes. */
    async complete(id: string, workerId: string, result: unknown): Promise<boolean> {
      const rows = await db
        .update(queueJob)
        .set({ status: "done", result: result ?? null, lockedBy: null, lockedUntil: null, lastError: null, updatedAt: sql`now()`, finishedAt: sql`now()` })
        .where(and(eq(queueJob.id, id), eq(queueJob.lockedBy, workerId), eq(queueJob.status, "running")))
        .returning({ id: queueJob.id });
      return rows.length > 0;
    },

    /**
     * Records a failed attempt. Retries later (`queued`, `run_at` pushed back by `QUEUE_BACKOFF`)
     * until `max_attempts`, or at once goes `dead` when `permanent` or out of attempts. Returns the
     * new status, or undefined when the lease was lost.
     */
    async fail(
      id: string,
      workerId: string,
      error: string,
      options: { permanent?: boolean; backoff?: { baseMs: number; maxMs: number } } = {},
    ): Promise<"queued" | "dead" | undefined> {
      const { baseMs, maxMs } = options.backoff ?? QUEUE_BACKOFF;
      const dead = options.permanent ? sql`true` : sql`${queueJob.attempts} >= ${queueJob.maxAttempts}`;
      const [row] = await db
        .update(queueJob)
        .set({
          status: sql`case when ${dead} then 'dead' else 'queued' end`,
          runAt: sql`case when ${dead} then ${queueJob.runAt}
            else now() + least(${maxMs}::float8, ${baseMs}::float8 * power(2, greatest(${queueJob.attempts} - 1, 0))) * interval '1 millisecond' end`,
          finishedAt: sql`case when ${dead} then now() else null end`,
          lastError: error.slice(0, 2000),
          lockedBy: null,
          lockedUntil: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(queueJob.id, id), eq(queueJob.lockedBy, workerId), eq(queueJob.status, "running")))
        .returning({ status: queueJob.status });
      return row?.status as "queued" | "dead" | undefined;
    },
  };
}

export type QueueStore = ReturnType<typeof createQueueStore>;
