/**
 * The job kinds (#46 slice 7, docs/QUEUE.md "Job kinds"): what `enqueueSweep` / `enqueueBundle`
 * put on the queue, and the handlers `bun run worker` runs them with.
 *
 * - `sweep`: for a design job, run the quantity sweep on the engine pool with the org's shop
 *   standards (`shop_standard`, the defaults when it has none), save the shortlist as
 *   `precomputed` configurations, select the recommendation, and emit `configs.ready`, all in one
 *   transaction. With a total quantity it also plans the total (`planTotal`, spec §7.16): each
 *   crate type of the plan is saved and linked as `precomputed` too, and the stamped plan is
 *   stored on the job (`design_job.total_plan`) if the job's total is still the one planned.
 *   It designs from the job's part as the browser sent it (`jobDesignPart`, with the measured
 *   outline), through the engine's request builder (`sweepRequestFor`), so its numbers are the
 *   browser's. Deduplicated per job, part version and total. Dead-lettered: the job goes to `error` and `job.error` is
 *   emitted.
 * - `bundle`: the server-built `bundle.zip` (slice 6). Its handler is `createBundleHandler` in
 *   src/server/artifacts, passed in as `createJobHandlers({ …, bundle })` (it needs blob storage).
 */
import { z } from "zod";
import { designPartHash, sweepRequestFor } from "@/engine/request";
import { DEFAULT_SWEEP_RULES, sweepDesignRequest } from "@/engine/sweep";
import { emitEvent } from "../events/emit";
import { type OrgContext, orgContext } from "../db/org";
import type { QueueJob } from "../db/queue";
import { createRepository, type Database, inTransaction, type Repository } from "../db/repository";
import { readOrgStandards } from "../standards";
import type { EnginePool } from "../workers/pool";
import { type JobHandler, PermanentJobError } from "./runner";
import type { TotalPlanResponse } from "@/lib/api/jobs";
import { totalPlanRecord } from "../jobs/totalPlan";
import { jobDesignPart } from "../jobs/designPart";

/** What `configs.ready` says of a stored total plan: enough for a log line or a toast. */
function totalPlanHint(p: TotalPlanResponse) {
  return { total: p.total, crates: p.plan?.crates ?? null, perCrate: p.plan?.perCrate ?? null, scoreUsdPerPart: p.plan?.scoreUsdPerPart ?? null };
}

export const SweepJobPayloadSchema = z.object({ jobId: z.uuid() });
export type SweepJobPayload = z.infer<typeof SweepJobPayloadSchema>;

export const BundleJobPayloadSchema = z.object({
  jobId: z.uuid(),
  /** The configurations to put in the ZIP, a folder each; empty means the job's shortlist. */
  configurationIds: z.array(z.uuid()).max(50),
});
export type BundleJobPayload = z.infer<typeof BundleJobPayloadSchema>;

export const JOB_KINDS = ["sweep", "bundle"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

async function requireJob(repo: Repository, ctx: OrgContext, jobId: string) {
  const job = await repo.jobs.get(ctx, jobId);
  if (!job) throw new Error(`No design job ${jobId} in this org.`);
  return job;
}

/**
 * Queues the sweep for design job `jobId`. Pass the repository `inTransaction` hands you to commit
 * the queue row with your change (the `onJobCreated` hook does, see `./register.ts`). A sweep
 * already queued or running for the job is returned, not doubled.
 */
export async function enqueueSweep(ctx: OrgContext, jobId: string, repo: Repository): Promise<QueueJob> {
  const job = await requireJob(repo, ctx, jobId);
  const payload: SweepJobPayload = { jobId };
  const dedupeKey = sweepDedupeKey(jobId, job.totalQuantity, job.designPartHash);
  const { job: queued } = await repo.queue.enqueue(ctx, { kind: "sweep", payload, dedupeKey });
  return queued;
}

/**
 * One sweep queued or running per job, part version and total: `<jobId>`, then `:part:<hash>`
 * (the first 16 hex of `design_part_hash`) once a browser has sent the job's part, then
 * `:total:<n>` with a total. A sweep already running for an old total or an old part doesn't
 * absorb a new one's (it would plan the old one), so a change mid-sweep still gets its results.
 */
export const sweepDedupeKey = (jobId: string, total: number | null, partHash: string | null = null): string =>
  `${jobId}${partHash ? `:part:${partHash.slice(0, 16)}` : ""}${total === null ? "" : `:total:${total}`}`;

/**
 * After a new engine starts: queues the sweep for every job of the org whose total has no plan
 * from this engine (`announceEngineVersion`'s per-org step). A stale plan is never served, so
 * this is what brings it back. Returns how many were queued.
 */
export async function replanTotals(repo: Repository, ctx: OrgContext, engineVersion: string): Promise<number> {
  const jobs = await repo.jobs.needingTotalPlan(ctx, engineVersion);
  for (const job of jobs) await enqueueSweep(ctx, job.id, repo);
  return jobs.length;
}

/**
 * Queues a server-built bundle for design job `jobId`. With a `dedupeKey` (the bundle id, see
 * src/server/artifacts), a bundle already queued or running under that key is returned, not doubled.
 */
export async function enqueueBundle(ctx: OrgContext, input: BundleJobPayload, repo: Repository, { dedupeKey }: { dedupeKey?: string } = {}): Promise<QueueJob> {
  const payload = BundleJobPayloadSchema.parse(input);
  await requireJob(repo, ctx, payload.jobId);
  const { job } = await repo.queue.enqueue(ctx, { kind: "bundle", payload, maxAttempts: 3, dedupeKey });
  return job;
}

export interface JobHandlerDeps {
  db: Database;
  pool: EnginePool;
  /** `createBundleHandler` (src/server/artifacts). Without it a bundle job dead-letters with "not available". */
  bundle?: JobHandler;
}

/** What a sweep job stores as its queue result: small, and enough to draw the curve. */
export interface SweepJobResult {
  /** Configurations saved: the shortlist, and the total plan's crate types not on it. */
  count: number;
  recommendedConfigurationId: string | null;
  inputHash: string;
  engineVersion: string;
  curve: { quantity: number; ok: boolean; binding: string | null; scoreUsdPerPart: number | null }[];
  /** The total the sweep planned (null without one), and whether its plan was stored (false when the job's total changed meanwhile). */
  total: number | null;
  totalPlanStored: boolean;
}

export function createJobHandlers({ db, pool, bundle }: JobHandlerDeps): Record<JobKind, JobHandler> {
  const sweep: JobHandler = async ({ org, job: queued, signal }) => {
    const parsed = SweepJobPayloadSchema.safeParse(queued.payload);
    if (!parsed.success) throw new PermanentJobError("A sweep job needs a jobId.");
    const repo = createRepository(db);
    const job = await repo.jobs.get(org, parsed.data.jobId);
    if (!job) throw new PermanentJobError(`No design job ${parsed.data.jobId}.`);
    const part = await repo.parts.get(org, job.partId);
    if (!part) throw new PermanentJobError(`No part ${job.partId}.`);
    if (job.status === "open" || job.status === "error") await repo.jobs.update(org, job.id, job.version, { status: "running" });

    // The part as the browser designs it (its measured outline too), through the engine's one
    // request builder, so this sweep is the browser's sweep (#46 "same inputs").
    const req = sweepRequestFor({
      part: jobDesignPart(job, part),
      rules: DEFAULT_SWEEP_RULES,
      standards: (await readOrgStandards(repo, org)).standards,
      total: job.totalQuantity,
    });
    /** The part version this sweep is for: its results are stored as current only while it still is. */
    const sweptPart = job.designPartHash;
    const partHash = designPartHash(req.part);
    // The recommendation and shortlist are among the part's suggested quantities (req.candidates);
    // the total plan (req.total) still splits by the full curve (#133).
    const report = await pool.run("designs", req);
    // Stored like a configuration saved from the browser (docs/API.md): the whole DesignRequest, so
    // the server can rebuild it (artifacts, "Use"), and the engine's DesignSummary of it.
    const requests = report.configurations.map((c) => sweepDesignRequest(req, c.quantityPerCrate, c.layoutKey));
    // The total plan's crate types that aren't on the shortlist are designed and saved too, so
    // each has a configuration (files, "Use").
    const shortlisted = (t: { quantity: number; layoutKey: string }) =>
      report.configurations.findIndex((c) => c.quantityPerCrate === t.quantity && c.layoutKey === t.layoutKey);
    const planTypes = (report.total?.types ?? []).filter((t) => shortlisted(t) < 0);
    const planRequests = planTypes.map((t) => sweepDesignRequest(req, t.quantity, t.layoutKey));
    const [designs, planDesigns] = await Promise.all([
      Promise.all(requests.map((r) => pool.run("design", r))),
      Promise.all(planRequests.map((r) => pool.run("design", r))),
    ]);
    signal.throwIfAborted();

    return inTransaction(db, async (tx) => {
      const ids: string[] = [];
      for (const [i, c] of report.configurations.entries()) {
        const { row } = await tx.configurations.save(org, {
          inputHash: c.inputHash,
          quantityPerCrate: c.quantityPerCrate,
          layout: c.layoutKey,
          settings: requests[i],
          resultSummary: designs[i]!.summary,
          score: c.scoreUsdPerPart,
          engineVersion: report.engineVersion,
          partHash,
        });
        await tx.configurations.link(org, job.id, row.id, "precomputed");
        ids.push(row.id);
      }
      const planIds = new Map<string, string>();
      for (const [i, t] of planTypes.entries()) {
        const d = planDesigns[i]!;
        const { row } = await tx.configurations.save(org, {
          inputHash: d.inputHash,
          quantityPerCrate: t.quantity,
          layout: t.layoutKey,
          settings: planRequests[i],
          resultSummary: d.summary,
          score: report.curve[t.quantity - 1]?.scoreUsdPerPart ?? null,
          engineVersion: report.engineVersion,
          partHash,
        });
        await tx.configurations.link(org, job.id, row.id, "precomputed");
        planIds.set(`${t.quantity}:${t.layoutKey}`, row.id);
      }
      let totalPlan: TotalPlanResponse | null = null;
      let totalPlanStored = false;
      if (req.total) {
        totalPlan = totalPlanRecord(report, req.total, (t) => {
          const k = shortlisted(t);
          return k >= 0 ? (ids[k] ?? null) : (planIds.get(`${t.quantity}:${t.layoutKey}`) ?? null);
        });
        // Only while the job's total is still the one planned: a newer total has its own sweep queued.
        totalPlanStored = await tx.jobs.setTotalPlan(org, job.id, req.total, totalPlan, sweptPart);
      }
      const recommendedConfigurationId = ids[0] ?? null;
      const current = await tx.jobs.get(org, job.id);
      // The job moves on only from open/running, and a selection someone already made is kept;
      // not at all when its part changed meanwhile (that part's sweep is queued).
      if (current && current.designPartHash === sweptPart && (current.status === "open" || current.status === "running")) {
        await tx.jobs.update(org, job.id, current.version, {
          status: report.problem || !recommendedConfigurationId ? "error" : "ready",
          selectedConfigurationId: current.selectedConfigurationId ?? recommendedConfigurationId,
        });
      }
      await emitEvent(tx, org, {
        jobId: job.id,
        type: "configs.ready",
        payload: {
          count: ids.length + planIds.size,
          recommendedConfigurationId,
          inputHash: report.inputHash,
          // A hint (clients read the plan from the snapshot): the total planned and its split.
          totalPlan: totalPlanStored && totalPlan ? totalPlanHint(totalPlan) : null,
          ...(report.problem ? { problem: report.problem.title } : {}),
        },
      });
      const result: SweepJobResult = {
        count: ids.length + planIds.size,
        recommendedConfigurationId,
        inputHash: report.inputHash,
        engineVersion: report.engineVersion,
        curve: report.curve,
        total: req.total ?? null,
        totalPlanStored,
      };
      return result;
    });
  };

  const bundleStub: JobHandler = async () => {
    throw new PermanentJobError("Server-built bundles aren't available yet.");
  };

  return { sweep, bundle: bundle ?? bundleStub };
}

/**
 * After a job is dead-lettered: a sweep's design job goes to `error` and `job.error` tells its
 * viewers. The message is generic (it is shown to users); the cause is in `queue_job.last_error`.
 */
export function createOnDead(db: Database) {
  return async (job: QueueJob): Promise<void> => {
    if (job.kind !== "sweep") return;
    const parsed = SweepJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) return;
    const org = orgContext(job.orgId);
    await inTransaction(db, async (tx) => {
      const current = await tx.jobs.get(org, parsed.data.jobId);
      if (!current) return;
      await tx.jobs.update(org, current.id, current.version, { status: "error" });
      await emitEvent(tx, org, {
        jobId: current.id,
        type: "job.error",
        payload: { message: "The quantity sweep failed. Start the job again, or check the part's size and mass." },
      });
    });
  };
}
