/**
 * Every new design job queues its quantity sweep (#46 slice 7): an `onJobCreated` hook, so the
 * queue row commits (or rolls back) with the job, in the transaction `POST /api/v1/jobs` opens.
 * Imported for its effect by `src/server/jobs/index.ts`; registering twice is harmless (the hook
 * is one function, and a Set holds it once).
 */
import { onJobCreated } from "../jobs/hooks";
import { enqueueSweep } from "./jobs";
import type { JobCreatedHook } from "../jobs/hooks";

export const enqueueSweepOnJobCreated: JobCreatedHook = async (tx, ctx, job) => {
  await enqueueSweep(ctx, job.id, tx);
};

onJobCreated(enqueueSweepOnJobCreated);
