/**
 * Every new design job queues its quantity sweep (#46 slice 7), and so does a job whose total
 * quantity changes to a new number (the sweep also plans the total, spec §7.16), and one whose
 * design part changes (the browser's measured outline, #46 "same inputs"): hooks, so the
 * queue row commits (or rolls back) with the job, in the transaction `POST /api/v1/jobs` or
 * `PATCH /api/v1/jobs/:id` opens. Imported for its effect by `src/server/jobs/index.ts`;
 * registering twice is harmless (each hook is one function, and a Set holds it once).
 */
import { onJobCreated, onPartChanged, onTotalPlanNeeded } from "../jobs/hooks";
import { enqueueSweep } from "./jobs";
import type { JobCreatedHook } from "../jobs/hooks";

export const enqueueSweepOnJobCreated: JobCreatedHook = async (tx, ctx, job) => {
  await enqueueSweep(ctx, job.id, tx);
};

onJobCreated(enqueueSweepOnJobCreated);
onTotalPlanNeeded(enqueueSweepOnJobCreated);
onPartChanged(enqueueSweepOnJobCreated);
