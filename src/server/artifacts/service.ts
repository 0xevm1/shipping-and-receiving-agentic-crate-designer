/**
 * Server-built files (#46 slice 6, docs/API.md "Artifacts"): the logic behind
 * `GET /api/v1/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}` and
 * `GET /api/v1/jobs/:id/bundle.zip`, and the queue's `bundle` job handler.
 *
 * - **Who may ask:** the job must be the caller's org's, and the configuration linked to that job;
 *   anything else is the same 404 as a missing row.
 * - **What is built:** the configuration's stored `DesignRequest` (the one the server verified when
 *   it was saved), by the running engine, with the job's part model read from blob storage
 *   (`model.ts`). Files go through `storeOnce` (`store.ts`): built on the first request, then
 *   served from blob storage under a content-addressed key (`artifactKey`, `bundleKey`). The
 *   crate GLB's key and the bundle id also name the part model's sha256: the GLB embeds the mesh,
 *   and `inputHash` hashes the part's design fields only (spec §5.1).
 * - **The job's total (#140):** when the job has a current total plan (`currentTotalPlan`), the
 *   shipment-level files (`spec.pdf`, `cutlist.csv`, `bundle.zip`) are built from the configuration's
 *   request with the total's crate types (`withTotal`), as the browser's Export package is, so they
 *   describe the whole shipment; the keys carry the hash of that request. `crate.glb` stays the
 *   configuration's own crate.
 * - **Deterministic bytes:** a file is dated with its configuration's `createdAt` (a bundle with
 *   its newest configuration's), in UTC, imperial units (the app's default): the same inputs and
 *   engine always give the same bytes, which is what makes the key content-addressed.
 * - **Never on the request thread:** builds run on the engine's worker threads (`pool`).
 */
import { createHash } from "node:crypto";
import { ARTIFACT_CONTENT_TYPES, type ArtifactRequest } from "@/engine/artifacts";
import { inputHash } from "@/engine/engine";
import { totalSplitFor, withTotal } from "@/engine/request";
import type { TotalSplit } from "@/domain/shipment";
import { type DesignRequest, DesignRequestSchema } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import { ARTIFACT_FILE_KINDS, type ArtifactFileName, type ArtifactUrlResponse, type BundleResponse, MAX_BUNDLE_CONFIGS } from "@/lib/api/artifacts";
import { artifactKey, bundleKey, modelSegment, versionSegment } from "../blob/keys";
import type { BlobStore } from "../blob/store";
import type { OrgContext } from "../db/org";
import { createRepository, type Database, type DesignJob, inTransaction, type JobConfiguration, type Repository } from "../db/repository";
import { ApiFailure, requireId } from "../http";
import { currentTotalPlan } from "../jobs/totalPlan";
import { BundleJobPayloadSchema, enqueueBundle } from "../queue/jobs";
import { type JobHandler, PermanentJobError } from "../queue/runner";
import type { EnginePool } from "../workers/pool";
import { partModelBytes, type PartModelBytes, partModelSha256 } from "./model";
import { type Stored, storeOnce } from "./store";

export type ArtifactsDeps = {
  db: Database;
  blob: BlobStore;
  org: OrgContext;
  /** The engine pool, asked for only when something has to be built (a cached file needs none). */
  pool: () => EnginePool;
};

/** Bundles of up to this many configurations are built during the request; larger ones go through the queue. */
export const BUNDLE_SYNC_MAX_CONFIGS = 8;

const UNITS = "imperial" as const;
const TIME_ZONE = "UTC";

const NO_JOB = "No such job.";
const NO_CONFIG = "No such configuration in this job.";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

async function requireJob(repo: Repository, org: OrgContext, id: string): Promise<DesignJob> {
  const job = await repo.jobs.get(org, requireId(id, "job"));
  if (!job) throw new ApiFailure(404, "not_found", NO_JOB);
  return job;
}

/** The stored request, as the engine takes it; a row that no longer parses can't be rebuilt. */
function designRequest(config: JobConfiguration): DesignRequest {
  const parsed = DesignRequestSchema.safeParse(config.settings);
  if (!parsed.success) throw new ApiFailure(422, "invalid_request", "This configuration was saved by an older version and can't be rebuilt. Save it again.");
  return parsed.data;
}

/** The job's current total plan as the split a request carries (#140), or null: no total, not planned yet, or no plan passes. */
function jobTotal(job: DesignJob): TotalSplit | null {
  const current = currentTotalPlan(job);
  return current?.plan ? totalSplitFor(current.total, current.plan.types) : null;
}

/** The request with how the part's model is read (its scale and up axis, spec §4); not hashed. */
const withScale = (req: DesignRequest, model: PartModelBytes | null): DesignRequest => ({
  ...req,
  part: { ...req.part, ...(model ? { mmPerUnit: model.mmPerUnit, upAxis: model.upAxis } : {}) },
});

async function loadModel(repo: Repository, blob: BlobStore, org: OrgContext, job: DesignJob): Promise<PartModelBytes | null> {
  const part = await repo.parts.get(org, job.partId);
  return part ? partModelBytes(repo, blob, org, part) : null;
}

/** The sha256 of the model the job's part embeds in a GLB, or null for none. */
async function jobModelSha256(repo: Repository, org: OrgContext, job: DesignJob): Promise<string | null> {
  const part = await repo.parts.get(org, job.partId);
  return part ? partModelSha256(part) : null;
}

async function presigned(blob: BlobStore, stored: Stored): Promise<{ url: string; expiresAt: string }> {
  const { url, expiresAt } = await blob.presignGet(stored.row.objectKey as Parameters<BlobStore["presignGet"]>[0], { downloadName: stored.fileName });
  return { url, expiresAt: expiresAt.toISOString() };
}

function urlResponse(stored: Stored, link: { url: string; expiresAt: string }, inputHash: string): ArtifactUrlResponse {
  return {
    ...link,
    artifactId: stored.row.id,
    kind: stored.row.kind,
    fileName: stored.fileName,
    contentType: stored.contentType,
    sha256: stored.row.sha256,
    sizeBytes: stored.row.sizeBytes,
    engineVersion: ENGINE_VERSION,
    inputHash,
    builtBy: stored.row.builtBy,
    cached: stored.cached,
  };
}

/** `GET /api/v1/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}`. */
export async function configurationArtifact(jobId: string, configurationId: string, file: string, deps: ArtifactsDeps): Promise<ArtifactUrlResponse> {
  const { db, blob, org } = deps;
  if (!Object.hasOwn(ARTIFACT_FILE_KINDS, file)) throw new ApiFailure(404, "not_found", "No such file. Ask for crate.glb, spec.pdf or cutlist.csv.");
  const kind = ARTIFACT_FILE_KINDS[file as ArtifactFileName];
  const repo = createRepository(db);
  const job = await requireJob(repo, org, jobId);
  const config = await repo.configurations.getForJob(org, job.id, requireId(configurationId, "configuration"));
  if (!config) throw new ApiFailure(404, "not_found", NO_CONFIG);
  // Everything but the crate's own model describes the whole shipment when the job has a total (#140).
  const total = kind === "glb" ? null : jobTotal(job);
  const req = withTotal(designRequest(config), total);
  const hash = total ? inputHash(req) : config.inputHash;

  let stored: Stored;
  try {
    stored = await storeOnce(deps, {
      key: artifactKey(org, hash, ENGINE_VERSION, file as ArtifactFileName, kind === "glb" ? await jobModelSha256(repo, org, job) : null),
      kind,
      configurationId: config.id,
      jobId: job.id,
      event: { file },
      build: async () => {
        const model = await loadModel(repo, blob, org, job);
        const request: ArtifactRequest = { ...withScale(req, model), units: UNITS, generatedAt: config.createdAt.toISOString(), timeZone: TIME_ZONE };
        const out = await deps.pool().run("artifact", { kind, request, glb: kind === "glb" ? (model?.bytes ?? null) : null });
        return { bytes: out.bytes, sha256: out.sha256, fileName: out.fileName, contentType: ARTIFACT_CONTENT_TYPES[kind] };
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "NoCrateError") throw new ApiFailure(422, "invalid_request", `There is no crate to export: ${e.message}`);
    throw e;
  }
  return urlResponse(stored, await presigned(blob, stored), hash);
}

type BundlePlan = { job: DesignJob; configs: JobConfiguration[]; bundleId: string; bundleHash: string; total: TotalSplit | null };

/**
 * Which configurations a bundle holds: `ids` in order (duplicates and equal inputs once), or every
 * configuration of the job when `ids` is empty. Unknown or unlinked ids are a 404.
 */
async function planBundle(repo: Repository, org: OrgContext, jobId: string, ids: string[]): Promise<BundlePlan> {
  const job = await requireJob(repo, org, jobId);
  if (ids.length > MAX_BUNDLE_CONFIGS) throw new ApiFailure(400, "invalid_request", `A bundle holds at most ${MAX_BUNDLE_CONFIGS} configurations.`, "configs");
  let configs: JobConfiguration[];
  if (ids.length) {
    configs = [];
    for (const id of ids) {
      const c = await repo.configurations.getForJob(org, job.id, requireId(id, "configuration"));
      if (!c) throw new ApiFailure(404, "not_found", NO_CONFIG, "configs");
      configs.push(c);
    }
  } else {
    configs = (await repo.configurations.listForJob(org, job.id)).slice(0, MAX_BUNDLE_CONFIGS);
  }
  // With a total (#140) each configuration is built as the whole shipment, so equal shipments are one folder.
  const total = jobTotal(job);
  const hashes = new Map(configs.map((c) => [c, total ? inputHash(withTotal(designRequest(c), total)) : c.inputHash]));
  const seen = new Set<string>();
  configs = configs.filter((c) => !seen.has(hashes.get(c)!) && seen.add(hashes.get(c)!));
  if (!configs.length) throw new ApiFailure(422, "invalid_request", "This job has no saved configurations to bundle yet.", "configs");
  // The manifest's bundleHash (spec §7.17): SHA-256 of the input hashes joined by newlines. The
  // id adds the part model (the bundle's GLBs embed it) and the engine version.
  const bundleHash = sha256(configs.map((c) => hashes.get(c)!).join("\n"));
  const model = modelSegment(await jobModelSha256(repo, org, job));
  return { job, configs, total, bundleHash, bundleId: `${bundleHash}-${model}-${versionSegment(ENGINE_VERSION)}` };
}

/** Builds (or finds) a planned bundle. Shared by the request path and the queue's `bundle` job. */
async function storeBundle(plan: BundlePlan, deps: ArtifactsDeps, repo: Repository): Promise<Stored> {
  const { blob, org } = deps;
  const requests = plan.configs.map((c) => withTotal(designRequest(c), plan.total));
  const newest = plan.configs.reduce((t, c) => (c.createdAt > t ? c.createdAt : t), plan.configs[0]!.createdAt);
  return storeOnce(deps, {
    key: bundleKey(org, plan.bundleId),
    kind: "zip",
    configurationId: plan.configs[0]!.id,
    jobId: plan.job.id,
    event: { bundleId: plan.bundleId },
    build: async () => {
      const model = await loadModel(repo, blob, org, plan.job);
      const out = await deps.pool().run("multiBundle", {
        configs: requests.map((r) => withScale(r, model)),
        glb: model?.bytes ?? null,
        options: { units: UNITS, generatedAt: newest.toISOString(), timeZone: TIME_ZONE },
      });
      return { bytes: out.zip, sha256: sha256(out.zip), fileName: out.name, contentType: "application/zip" };
    },
  });
}

export type BundleOutcome = { status: 200 | 202; body: BundleResponse };

/**
 * `GET /api/v1/jobs/:id/bundle.zip?configs=…`. Stored already: 200 with a presigned URL. Up to
 * `syncMax` configurations: built now on the worker threads, then 200. More: queued (one queue
 * job per bundle, deduplicated), 202, and `artifact.ready` when the worker has stored it.
 */
export async function jobBundle(jobId: string, ids: string[], deps: ArtifactsDeps, { syncMax = BUNDLE_SYNC_MAX_CONFIGS } = {}): Promise<BundleOutcome> {
  const { db, blob, org } = deps;
  const repo = createRepository(db);
  const plan = await planBundle(repo, org, jobId, ids);
  const configurationIds = plan.configs.map((c) => c.id);
  const key = bundleKey(org, plan.bundleId);

  const row = await repo.artifacts.getByKey(org, key);
  const ready = row && (await blob.head(key));
  if (!ready && plan.configs.length > syncMax) {
    const queued = await inTransaction(db, (tx) => enqueueBundle(org, { jobId: plan.job.id, configurationIds }, tx, { dedupeKey: plan.bundleId }));
    return { status: 202, body: { status: "queued", bundleId: plan.bundleId, configurationIds, queueJobId: queued.id } };
  }
  const stored = await storeBundle(plan, deps, repo);
  return {
    status: 200,
    body: { status: "ready", bundleId: plan.bundleId, configurationIds, ...urlResponse(stored, await presigned(blob, stored), plan.bundleHash) },
  };
}

/** The queue's `bundle` job (docs/QUEUE.md): pass it to `createJobHandlers({ …, bundle })`. */
export function createBundleHandler({ db, blob, pool }: Omit<ArtifactsDeps, "org">): JobHandler {
  return async ({ org, job, signal }) => {
    const parsed = BundleJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new PermanentJobError("A bundle job needs a jobId and configurationIds.");
    const repo = createRepository(db);
    let plan: BundlePlan;
    try {
      plan = await planBundle(repo, org, parsed.data.jobId, parsed.data.configurationIds);
    } catch (e) {
      // A job or configuration that is gone won't come back: don't retry.
      if (e instanceof ApiFailure) throw new PermanentJobError(e.message);
      throw e;
    }
    signal.throwIfAborted();
    const stored = await storeBundle(plan, { db, blob, org, pool }, repo);
    return { artifactId: stored.row.id, bundleId: plan.bundleId, cached: stored.cached };
  };
}
