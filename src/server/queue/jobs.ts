/**
 * The job kinds (#46 slice 7, docs/QUEUE.md "Job kinds"): what `enqueueSweep` / `enqueueBundle`
 * put on the queue, and the handlers `bun run worker` runs them with.
 *
 * - `sweep`: for a design job, run the quantity sweep on the engine pool with the org's shop
 *   standards (`shop_standard`, the defaults when it has none), save the shortlist as
 *   `precomputed` configurations, select the recommendation, and emit `configs.ready`, all in one
 *   transaction. Dead-lettered: the job goes to `error` and `job.error` is emitted.
 * - `bundle`: the server-built `bundle.zip` (slice 6). Its handler is `createBundleHandler` in
 *   src/server/artifacts, passed in as `createJobHandlers({ …, bundle })` (it needs blob storage).
 */
import { z } from "zod";
import { DEFAULT_SWEEP_RULES, sweepDesignRequest, type SweepRequest } from "@/engine/sweep";
import { emitEvent } from "../events/emit";
import { type OrgContext, orgContext } from "../db/org";
import type { QueueJob } from "../db/queue";
import { createRepository, type Database, inTransaction, type Repository } from "../db/repository";
import { readOrgStandards } from "../standards";
import type { EnginePool } from "../workers/pool";
import { type JobHandler, PermanentJobError } from "./runner";

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
  await requireJob(repo, ctx, jobId);
  const payload: SweepJobPayload = { jobId };
  const { job } = await repo.queue.enqueue(ctx, { kind: "sweep", payload, dedupeKey: jobId });
  return job;
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
  count: number;
  recommendedConfigurationId: string | null;
  inputHash: string;
  engineVersion: string;
  curve: { quantity: number; ok: boolean; binding: string | null; scoreUsdPerPart: number | null }[];
  total: unknown;
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

    const req: SweepRequest = {
      part: {
        id: part.id,
        name: part.name,
        mass_kg: part.massKg,
        dimensions_mm: [part.sizeXMm, part.sizeYMm, part.sizeZMm],
        material: part.material ?? undefined,
      },
      rules: DEFAULT_SWEEP_RULES,
      standards: (await readOrgStandards(repo, org)).standards,
      total: job.totalQuantity,
    };
    const report = await pool.run("designs", req);
    // Stored like a configuration saved from the browser (docs/API.md): the whole DesignRequest, so
    // the server can rebuild it (artifacts, "Use"), and the engine's DesignSummary of it.
    const requests = report.configurations.map((c) => sweepDesignRequest(req, c.quantityPerCrate, c.layoutKey));
    const designs = await Promise.all(requests.map((r) => pool.run("design", r)));
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
        });
        await tx.configurations.link(org, job.id, row.id, "precomputed");
        ids.push(row.id);
      }
      const recommendedConfigurationId = ids[0] ?? null;
      const current = await tx.jobs.get(org, job.id);
      // The job moves on only from open/running, and a selection someone already made is kept.
      if (current && (current.status === "open" || current.status === "running")) {
        await tx.jobs.update(org, job.id, current.version, {
          status: report.problem || !recommendedConfigurationId ? "error" : "ready",
          selectedConfigurationId: current.selectedConfigurationId ?? recommendedConfigurationId,
        });
      }
      await emitEvent(tx, org, {
        jobId: job.id,
        type: "configs.ready",
        payload: { count: ids.length, recommendedConfigurationId, inputHash: report.inputHash, ...(report.problem ? { problem: report.problem.title } : {}) },
      });
      const result: SweepJobResult = {
        count: ids.length,
        recommendedConfigurationId,
        inputHash: report.inputHash,
        engineVersion: report.engineVersion,
        curve: report.curve,
        total: report.total,
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
