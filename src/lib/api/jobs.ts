/**
 * Request and response shapes for `/api/v1/jobs` (#46 slice 5). Pure Zod, shared by the Route
 * Handlers and the browser (src/state/jobApi.ts); docs/API.md is the reference.
 *
 *   POST  /api/v1/jobs                 open a job for a part (or reuse the part's open one)
 *   GET   /api/v1/jobs/:id             snapshot: job, part, configurations, artifacts, lastEventId
 *   POST  /api/v1/jobs/:id/configs     save a configuration made in the browser (server-verified)
 *   PATCH /api/v1/jobs/:id             selection, status, notes; optimistic on `version`
 *
 * lib sits below the engine (eslint layers), so the engine's own types appear here as plain JSON
 * objects: the server parses `request` with `DesignRequestSchema` and recomputes `summary`, and
 * the browser parses a saved `summary` with `DesignSummarySchema` (src/engine/schemas.ts).
 */
import { z } from "zod";
import { ApiErrorSchema, PartResponseSchema } from "./parts";

const id = z.uuid();
const json = z.record(z.string(), z.unknown());
const datetime = z.iso.datetime({ offset: true });

export const JOB_STATUSES = ["open", "running", "ready", "error", "archived"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export const CONFIGURATION_ORIGINS = ["precomputed", "user"] as const;

/** The longest `Idempotency-Key` header accepted. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/**
 * `POST /api/v1/jobs`. Name the part by `partId` (one already on the server, e.g. from
 * `POST /parts`) or by `catalogId` (a catalog entry; the server registers it as a part the first
 * time). With `reuse`, the newest open job for the same part (same catalog entry, or an upload of
 * the same GLB) is returned instead of opening another: tabs that load one part meet on one job.
 */
export const CreateJobRequestSchema = z
  .object({
    partId: id.optional(),
    catalogId: z.string().min(1).max(64).optional(),
    totalQuantity: z.int().positive().max(1_000_000).optional(),
    reuse: z.boolean().optional(),
  })
  .refine((b) => (b.partId === undefined) !== (b.catalogId === undefined), { message: "Name the part by partId or catalogId (one of them)." });
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JobSchema = z.object({
  id,
  partId: id,
  status: JobStatusSchema,
  totalQuantity: z.int().positive().nullable(),
  selectedConfigurationId: id.nullable(),
  notes: z.string().nullable(),
  /** Bumped by every PATCH; send it back as `version` to change the job. */
  version: z.int().positive(),
  createdAt: datetime,
  updatedAt: datetime,
});
export type JobResponse = z.infer<typeof JobSchema>;

export const CreateJobResponseSchema = z.object({
  job: JobSchema,
  /** False when `reuse` found an open job (status 200 rather than 201). */
  created: z.boolean(),
});
export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;

/** One saved configuration of a job. `summary` is the engine's `DesignSummary`. */
export const ConfigurationSchema = z.object({
  id,
  inputHash: z.string(),
  engineVersion: z.string(),
  quantityPerCrate: z.int().positive(),
  /** The first crate type's layout key ("auto" when it had none). */
  layout: z.string(),
  /** Crate cost per part, USD; lower is better. Null when there is no crate. */
  score: z.number().nullable(),
  origin: z.enum(CONFIGURATION_ORIGINS),
  /** The engine's `DesignSummary` (validate with `DesignSummarySchema`). */
  summary: json.nullable(),
  /** What to put back on screen: the request's settings, layout pick and ranking (not the part or standards). */
  design: z.object({ settings: json, layoutKey: z.string().nullable(), ranking: z.string() }),
  createdAt: datetime,
  /** When it joined this job. */
  addedAt: datetime,
});
export type ConfigurationResponse = z.infer<typeof ConfigurationSchema>;

export const ArtifactSchema = z.object({
  id,
  configurationId: id,
  kind: z.string(),
  sha256: z.string(),
  sizeBytes: z.int().nonnegative(),
  builtBy: z.enum(["browser", "server"]),
  createdAt: datetime,
});

/**
 * `GET /api/v1/jobs/:id`. `lastEventId` is read before the rest, so subscribing with
 * `subscribeJobEvents(id, …, { lastEventId })` misses nothing; an event may repeat what the
 * snapshot already shows, never the other way round.
 */
export const JobSnapshotSchema = z.object({
  job: JobSchema,
  part: PartResponseSchema,
  configurations: z.array(ConfigurationSchema),
  artifacts: z.array(ArtifactSchema),
  lastEventId: z.int().nonnegative(),
  /** The server's `ENGINE_VERSION`; a client with another one should reload before saving. */
  engineVersion: z.string(),
});
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;

/**
 * `POST /api/v1/jobs/:id/configs`: what the browser's engine designed. `request` is the engine's
 * `DesignRequest`; `engineVersion`, `inputHash` and `summary` are its answer. The server runs the
 * same request and stores it only if its own `inputHash` and `summary` are equal.
 */
export const SaveConfigurationRequestSchema = z.object({
  request: json,
  engineVersion: z.string().min(1),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  summary: json,
});
export type SaveConfigurationRequest = z.infer<typeof SaveConfigurationRequestSchema>;

export const SaveConfigurationResponseSchema = z.object({
  configuration: ConfigurationSchema,
  /** False when this job already had it (status 200 rather than 201): nothing new was stored. */
  created: z.boolean(),
});
export type SaveConfigurationResponse = z.infer<typeof SaveConfigurationResponseSchema>;

/** `PATCH /api/v1/jobs/:id`: `version` is the one the client read; at least one other field. */
export const PatchJobRequestSchema = z
  .object({
    version: z.int().positive(),
    selectedConfigurationId: id.nullable().optional(),
    status: JobStatusSchema.optional(),
    notes: z.string().max(4000).nullable().optional(),
    totalQuantity: z.int().positive().max(1_000_000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "version"), { message: "Change at least one of selectedConfigurationId, status, notes, totalQuantity." });
export type PatchJobRequest = z.infer<typeof PatchJobRequestSchema>;

export const PatchJobResponseSchema = z.object({ job: JobSchema });

/** 409 `engine_version_mismatch`: the browser runs another engine. Reload, then save again. */
export const EngineMismatchErrorSchema = ApiErrorSchema.extend({
  error: ApiErrorSchema.shape.error.extend({ code: z.literal("engine_version_mismatch") }),
  /** The engine the server runs. */
  engineVersion: z.string(),
});

/** 409 `version_conflict`: the job as it is now, so the client can show what changed. */
export const VersionConflictErrorSchema = ApiErrorSchema.extend({
  error: ApiErrorSchema.shape.error.extend({ code: z.literal("version_conflict") }),
  job: JobSchema,
});
