/**
 * Jobs and configurations (#46 slice 5): the logic behind `/api/v1/jobs*`. Route Handlers parse
 * nothing themselves; they hand the Request here with the caller's org. docs/API.md documents
 * every status code below.
 *
 * Every write runs in one transaction with its events, emitted last (see `emitEvent`), and takes
 * an optional `Idempotency-Key` (`once`).
 */
import { catalog } from "@/domain/catalog";
import { ENGINE_VERSION } from "@/engine/version";
import {
  type CreateJobResponse,
  CreateJobRequestSchema,
  type JobSnapshot,
  PatchJobRequestSchema,
  type PatchJobResponseSchema,
  SaveConfigurationRequestSchema,
  type SaveConfigurationResponse,
} from "@/lib/api/jobs";
import type { z } from "zod";
import type { OrgContext } from "../db/org";
import { createRepository, type Database, type DesignJobPatch, inTransaction, type Part, type Repository } from "../db/repository";
import { emitEvent } from "../events/emit";
import { ApiFailure, readJson, requireId } from "../http";
import { partResponse } from "../parts/create";
import { runJobCreatedHooks } from "./hooks";
import { idempotencyKey, once, type Outcome, requestHash } from "./idempotency";
import { artifactResponse, configurationResponse, jobResponse } from "./serialize";
import { verifyConfiguration } from "./verify";

export type JobsDeps = { db: Database; org: OrgContext };

const NO_JOB = "No such job.";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ApiFailure(400, "invalid_request", issue.message, issue.path.join(".") || undefined);
  }
  return parsed.data;
}

async function requireJob(tx: Repository, org: OrgContext, id: string, forUpdate = false) {
  const job = await tx.jobs.get(org, requireId(id, "job"), { forUpdate });
  // Another org's job is indistinguishable from a missing one.
  if (!job) throw new ApiFailure(404, "not_found", NO_JOB);
  return job;
}

/** The lock key that makes "find or open a job" one at a time per part identity. */
const identityKey = (p: Part) => (p.catalogId ? `catalog:${p.catalogId}` : p.modelSha256 && p.source === "upload" ? `model:${p.modelSha256}` : `part:${p.id}`);

/** `POST /api/v1/jobs`. 201 with a new job, or 200 with the reused one (`reuse: true`). */
export async function createJob(request: Request, { db, org }: JobsDeps): Promise<Outcome<CreateJobResponse>> {
  const raw = await readJson(request);
  const body = parse(CreateJobRequestSchema, raw);
  const key = idempotencyKey(request);
  return inTransaction(db, (tx) =>
    once<CreateJobResponse>(tx, org, key, requestHash("POST", "/api/v1/jobs", raw), async () => {
      let part: Part;
      let partCreated = false;
      if (body.catalogId !== undefined) {
        const entry = catalog.parts.find((p) => p.id === body.catalogId);
        if (!entry) throw new ApiFailure(404, "not_found", `There is no catalog part ${body.catalogId}.`, "catalogId");
        const [x, y, z] = entry.dimensions_mm;
        const ensured = await tx.parts.ensureCatalog(org, {
          catalogId: entry.id,
          name: entry.name,
          material: entry.material ?? null,
          massKg: entry.mass_kg,
          sizeXMm: x,
          sizeYMm: y,
          sizeZMm: z,
          source: "catalog",
        });
        part = ensured.row;
        partCreated = ensured.created;
      } else {
        const found = await tx.parts.get(org, requireId(body.partId!, "part"));
        if (!found) throw new ApiFailure(404, "not_found", "No such part.", "partId");
        part = found;
      }

      if (body.reuse) {
        await tx.jobs.lock(org, identityKey(part));
        const existing = await tx.jobs.findReusable(org, part);
        if (existing) {
          return {
            status: 200,
            body: { job: jobResponse(existing), created: false },
            emit: async () => {
              if (partCreated) await emitEvent(tx, org, { jobId: null, type: "part.created", payload: { partId: part.id } });
            },
          };
        }
      }

      const job = await tx.jobs.create(org, { partId: part.id, totalQuantity: body.totalQuantity ?? null });
      await runJobCreatedHooks(tx, org, job);
      return {
        status: 201,
        body: { job: jobResponse(job), created: true },
        emit: async () => {
          if (partCreated) await emitEvent(tx, org, { jobId: null, type: "part.created", payload: { partId: part.id } });
          await emitEvent(tx, org, { jobId: job.id, type: "job.created", payload: { partId: part.id } });
        },
      };
    }),
  );
}

/**
 * `GET /api/v1/jobs/:id`. `lastEventId` is read before the rows, so a client that snapshots and
 * then subscribes from it can see an event twice (harmless: configurations are keyed by id) but
 * never miss one.
 */
export async function getJobSnapshot(id: string, { db, org }: JobsDeps): Promise<JobSnapshot> {
  const repo = createRepository(db);
  const jobId = requireId(id, "job");
  // First: everything committed before this id is in the rows read below.
  const lastEventId = await repo.events.lastIdForStream(org, jobId);
  const job = await requireJob(repo, org, jobId);
  const [part, configurations, artifacts] = await Promise.all([
    repo.parts.get(org, job.partId),
    repo.configurations.listForJob(org, job.id),
    repo.artifacts.listForJob(org, job.id),
  ]);
  return {
    job: jobResponse(job),
    part: partResponse(part!),
    configurations: configurations.map(configurationResponse),
    artifacts: artifacts.map(artifactResponse),
    lastEventId,
    engineVersion: ENGINE_VERSION,
  };
}

/**
 * `POST /api/v1/jobs/:id/configs`. Recomputes the configuration with the engine (`verify.ts`),
 * stores it content-addressed, links it to the job and emits `config.added`. 201 when the job
 * gained it, 200 when it already had it (no second row, no second event).
 */
export async function saveConfiguration(id: string, request: Request, { db, org }: JobsDeps): Promise<Outcome<SaveConfigurationResponse>> {
  const raw = await readJson(request);
  const body = parse(SaveConfigurationRequestSchema, raw);
  const key = idempotencyKey(request);
  const jobId = requireId(id, "job");
  return inTransaction(db, (tx) =>
    once(tx, org, key, requestHash("POST", `/api/v1/jobs/${jobId}/configs`, raw), async () => {
      const job = await requireJob(tx, org, jobId);
      // After the replay check, so a change replayed after a deploy still gets its stored answer.
      const { request: designRequest, design } = verifyConfiguration(body);
      const { summary } = design;
      const first = summary.crates[0]!;
      const saved = await tx.configurations.save(org, {
        inputHash: design.inputHash,
        quantityPerCrate: first.quantity,
        layout: first.layoutKey ?? "auto",
        settings: designRequest,
        resultSummary: summary,
        score: summary.totals.parts > 0 ? summary.totals.costUsd / summary.totals.parts : null,
        engineVersion: design.engineVersion,
      });
      const link = await tx.configurations.link(org, job.id, saved.row.id, "user");
      const linked = await tx.configurations.getForJob(org, job.id, saved.row.id);
      return {
        status: link.created ? 201 : 200,
        body: { configuration: configurationResponse(linked!), created: link.created },
        emit: async () => {
          if (link.created) {
            await emitEvent(tx, org, { jobId: job.id, type: "config.added", payload: { configurationId: saved.row.id, inputHash: design.inputHash } });
          }
        },
      };
    }),
  );
}

/**
 * `PATCH /api/v1/jobs/:id`: selection, status, notes, total quantity, at the `version` the client
 * read. A stale version gets 409 `version_conflict` with the job as it is now. A selection must be
 * one of the job's configurations (422). Emits `recommendation.changed` when the selection moves.
 */
export async function patchJob(id: string, request: Request, { db, org }: JobsDeps): Promise<Outcome<z.infer<typeof PatchJobResponseSchema>>> {
  const raw = await readJson(request);
  const { version, ...changes } = parse(PatchJobRequestSchema, raw);
  const key = idempotencyKey(request);
  const jobId = requireId(id, "job");
  return inTransaction(db, (tx) =>
    once(tx, org, key, requestHash("PATCH", `/api/v1/jobs/${jobId}`, raw), async () => {
      const current = await requireJob(tx, org, jobId, true);
      if (current.version !== version) {
        throw new ApiFailure(409, "version_conflict", "Someone else changed this job. Here is how it is now.", "version", { job: jobResponse(current) });
      }
      const selection = changes.selectedConfigurationId;
      if (selection && !(await tx.configurations.isLinked(org, jobId, selection))) {
        throw new ApiFailure(422, "invalid_request", "That configuration isn't one of this job's.", "selectedConfigurationId");
      }
      const patch: DesignJobPatch = {};
      if (changes.selectedConfigurationId !== undefined) patch.selectedConfigurationId = changes.selectedConfigurationId;
      if (changes.status !== undefined) patch.status = changes.status;
      if (changes.notes !== undefined) patch.notes = changes.notes;
      if (changes.totalQuantity !== undefined) patch.totalQuantity = changes.totalQuantity;
      const updated = await tx.jobs.update(org, jobId, version, patch);
      if (!updated) throw new Error("A locked job at the expected version failed to update.");
      const moved = selection !== undefined && selection !== current.selectedConfigurationId;
      return {
        status: 200,
        body: { job: jobResponse(updated) },
        emit: async () => {
          if (moved) await emitEvent(tx, org, { jobId, type: "recommendation.changed", payload: { configurationId: selection } });
        },
      };
    }),
  );
}
