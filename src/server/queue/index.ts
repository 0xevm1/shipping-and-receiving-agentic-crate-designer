/**
 * The job queue (#46 slice 7, docs/QUEUE.md) for Route Handlers. Server-only.
 *
 * New design jobs queue their sweep by themselves (`./register.ts`, an `onJobCreated` hook). To
 * queue work inside your own transaction, pass the repository `inTransaction` gives you:
 *
 *   await inTransaction(getDb(), (tx) => enqueueBundle(ctx, { jobId, configurationIds }, tx));
 *
 * `bun run worker` runs the jobs (scripts/worker.ts).
 */
import "server-only";
import { getRepository } from "../db/client";
import type { OrgContext } from "../db/org";
import type { QueueJob } from "../db/queue";
import type { Repository } from "../db/repository";
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

/** Queues the quantity sweep for a design job (deduplicated per job). */
export const enqueueSweep = (ctx: OrgContext, jobId: string, repo: Repository = getRepository()): Promise<QueueJob> => enqueueSweepOn(ctx, jobId, repo);

/** Queues a server-built bundle for a design job. */
export const enqueueBundle = (
  ctx: OrgContext,
  input: BundleJobPayload,
  repo: Repository = getRepository(),
  options: { dedupeKey?: string } = {},
): Promise<QueueJob> => enqueueBundleOn(ctx, input, repo, options);
