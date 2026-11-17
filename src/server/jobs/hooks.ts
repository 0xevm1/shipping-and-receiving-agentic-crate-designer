/**
 * What happens when a job opens, or its total quantity needs a plan (#46). The job queue
 * registers hooks here that enqueue the server-side sweep (`src/server/queue/register.ts`; the
 * worker then saves the shortlist and the total plan and emits `configs.ready`, docs/QUEUE.md).
 * The browser still sweeps for its own hint (`useBestQuantity`) and saves what the user keeps
 * through `POST /jobs/:id/configs`.
 *
 * Hooks run inside the transaction that creates or changes the job, before its events, so an
 * enqueue commits (or rolls back) with the change. Keep them to a few statements: no engine work
 * and no network calls in here. A hook that throws fails the request.
 */
import type { OrgContext } from "../db/org";
import type { DesignJob, Repository } from "../db/repository";

export type JobCreatedHook = (tx: Repository, ctx: OrgContext, job: DesignJob) => Promise<void>;
/** The job (as changed) has a new total quantity to plan. */
export type TotalPlanNeededHook = JobCreatedHook;

const created = new Set<JobCreatedHook>();
const totalChanged = new Set<TotalPlanNeededHook>();

/** Registers `hook` for every new job. Returns a function that removes it. */
export function onJobCreated(hook: JobCreatedHook): () => void {
  created.add(hook);
  return () => created.delete(hook);
}

export async function runJobCreatedHooks(tx: Repository, ctx: OrgContext, job: DesignJob): Promise<void> {
  for (const hook of created) await hook(tx, ctx, job);
}

/** Registers `hook` for every job whose total quantity is set to a new number (PATCH). */
export function onTotalPlanNeeded(hook: TotalPlanNeededHook): () => void {
  totalChanged.add(hook);
  return () => totalChanged.delete(hook);
}

export async function runTotalPlanNeededHooks(tx: Repository, ctx: OrgContext, job: DesignJob): Promise<void> {
  for (const hook of totalChanged) await hook(tx, ctx, job);
}
