/**
 * What happens when a job opens (#46). The server-side sweep (`engine.sweep`, then
 * `configs.ready`) belongs to the job-queue slice: it registers a hook here that enqueues the
 * sweep, and this slice doesn't run one. Until then the browser runs the sweep itself
 * (`useBestQuantity`) and saves what the user keeps through `POST /jobs/:id/configs`.
 *
 * Hooks run inside the transaction that creates the job, before its `job.created` event, so an
 * enqueue commits (or rolls back) with the job. Keep them to a few statements: no engine work and
 * no network calls in here. A hook that throws fails the job's creation.
 */
import type { OrgContext } from "../db/org";
import type { DesignJob, Repository } from "../db/repository";

export type JobCreatedHook = (tx: Repository, ctx: OrgContext, job: DesignJob) => Promise<void>;

const hooks = new Set<JobCreatedHook>();

/** Registers `hook` for every new job. Returns a function that removes it. */
export function onJobCreated(hook: JobCreatedHook): () => void {
  hooks.add(hook);
  return () => hooks.delete(hook);
}

export async function runJobCreatedHooks(tx: Repository, ctx: OrgContext, job: DesignJob): Promise<void> {
  for (const hook of hooks) await hook(tx, ctx, job);
}
