/**
 * The job queue (#46 slice 7, docs/QUEUE.md) for Route Handlers. Server-only.
 *
 *   await inTransaction(getDb(), async (tx) => { … create the job … });
 *   await enqueueSweep(ctx, job.id);                // or pass the drizzle transaction to commit together
 *
 * `bun run worker` runs the jobs (scripts/worker.ts).
 */
import "server-only";
import { getDb } from "../db/client";
import type { OrgContext } from "../db/org";
import type { QueueJob } from "../db/queue";
import type { Database, Transaction } from "../db/repository";
import { type BundleJobPayload, enqueueBundle as enqueueBundleOn, enqueueSweep as enqueueSweepOn } from "./jobs";

export {
  BundleJobPayloadSchema,
  JOB_KINDS,
  SweepJobPayloadSchema,
  type BundleJobPayload,
  type JobKind,
  type SweepJobPayload,
  type SweepJobResult,
} from "./jobs";
export { PermanentJobError, type JobContext, type JobHandler } from "./runner";

/** Queues the quantity sweep for a design job (deduplicated per job). `executor`: a drizzle transaction to join. */
export const enqueueSweep = (ctx: OrgContext, jobId: string, executor: Database | Transaction = getDb()): Promise<QueueJob> =>
  enqueueSweepOn(ctx, jobId, executor);

/** Queues a server-built bundle for a design job. */
export const enqueueBundle = (ctx: OrgContext, input: BundleJobPayload, executor: Database | Transaction = getDb()): Promise<QueueJob> =>
  enqueueBundleOn(ctx, input, executor);
