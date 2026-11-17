/**
 * Request and response shapes for `/api/v1/jobs` (#46 slice 5). Pure Zod, shared by the Route
 * Handlers and the browser (src/state/jobApi.ts); docs/API.md is the reference.
 *
 *   POST  /api/v1/jobs                 open a job for a part (or reuse the part's open one)
 *   GET   /api/v1/jobs/:id             snapshot: job, part, configurations, artifacts, total plan, lastEventId
 *   POST  /api/v1/jobs/:id/configs     save a configuration made in the browser (server-verified)
 *   PATCH /api/v1/jobs/:id             selection, status, notes, total quantity; optimistic on `version`
 *   PUT   /api/v1/jobs/:id/part        the part as the browser designs it (its measured outline); re-sweeps when it changed
 *
 * lib sits below the engine (eslint layers), so the engine's own types appear here as plain JSON
 * objects: the server parses `request` with `DesignRequestSchema` and recomputes `summary`, and
 * the browser parses a saved `summary` with `DesignSummarySchema` (src/engine/schemas.ts).
 */
import { z } from "zod";
import { MessageSchema } from "./designs";
import { ApiErrorSchema, PartResponseSchema } from "./parts";

const id = z.uuid();
const json = z.record(z.string(), z.unknown());
const datetime = z.iso.datetime({ offset: true });

const JOB_STATUSES = ["open", "running", "ready", "error", "archived"] as const;
const JobStatusSchema = z.enum(JOB_STATUSES);
const CONFIGURATION_ORIGINS = ["precomputed", "user"] as const;

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
    /**
     * The part as the client's engine designs it: the engine's `DesignPart` (id, name, mass_kg,
     * dimensions_mm, material, profile), checked with `DesignPartSchema`. Optional: without it the
     * job is designed from the part's own facts. See `PutJobPartRequestSchema`.
     */
    designPart: json.optional(),
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
  /**
   * `designPartHash` of the part the job is designed from, as a client sent it (`designPart`, `PUT
   * /jobs/:id/part`); null while it is designed from the part's own facts. A client whose part
   * hashes differently sends its own. Absent from servers (and job copies cached) before it existed.
   */
  partHash: z.string().nullable().optional(),
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
  /**
   * What to put back on screen: the request's settings, layout pick and ranking. `part` (its
   * design fields) and `standards` complete the request, so a client can rebuild the files of
   * a saved configuration with the same `inputHash` (Download all of a job, #46 slice 6).
   */
  design: z.object({ settings: json, layoutKey: z.string().nullable(), ranking: z.string(), part: json.optional(), standards: json.optional() }),
  createdAt: datetime,
  /** When it joined this job. */
  addedAt: datetime,
});
export type ConfigurationResponse = z.infer<typeof ConfigurationSchema>;

const ArtifactSchema = z.object({
  id,
  configurationId: id,
  kind: z.string(),
  sha256: z.string(),
  sizeBytes: z.int().nonnegative(),
  builtBy: z.enum(["browser", "server"]),
  createdAt: datetime,
});

/**
 * The job's total-quantity plan (spec §7.16): how `total` parts ship, split evenly by `planTotal`
 * over the server's sweep with the job's standards and the default packing rules. Stamped with
 * the engine and the sweep's `inputHash`; a snapshot only ever carries one whose `total` is the
 * job's `totalQuantity` and whose `engineVersion` is the server's.
 */
export const TotalPlanSchema = z.object({
  total: z.int().positive(),
  engineVersion: z.string().min(1),
  /** The sweep request's hash (part, rules, standards, total). */
  inputHash: z.string(),
  basis: z.enum(["crate-and-freight", "crate-only"]),
  computedAt: datetime,
  /** Null when no even split passes (one part alone fails a hard check). */
  plan: z
    .object({
      crates: z.int().positive(),
      /** The most parts in any crate. */
      perCrate: z.int().positive(),
      /** One or two crate types; their quantities differ by at most one. */
      types: z.array(
        z.object({
          /** "A" for the fuller crates, "B" for those with one part fewer. */
          label: z.string(),
          count: z.int().positive(),
          quantity: z.int().positive(),
          layoutKey: z.string(),
          /** The job's `precomputed` configuration for this crate (files, "Use"); null if it couldn't be saved. */
          configurationId: id.nullable(),
        }),
      ),
      crateCostUsd: z.number(),
      freightUsd: z.number().nullable(),
      /** (crate cost + freight) ÷ total parts. */
      scoreUsdPerPart: z.number(),
    })
    .nullable(),
  /** Why this many crates (`explainTotalPlan`): render with the client's units. */
  rationale: MessageSchema,
});
export type TotalPlanResponse = z.infer<typeof TotalPlanSchema>;

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
  /**
   * The plan for the job's `totalQuantity`, or null: no total, or the server is still planning
   * it (a new total, or a plan made by another engine version, is never served as current).
   */
  totalPlan: TotalPlanSchema.nullable(),
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

/**
 * `PUT /api/v1/jobs/:id/part` (#46 "same inputs"): the part as the client's engine designs it,
 * the engine's `DesignPart` with the measured outline (`profile`, spec §7.5b) once the model has
 * been measured. When it differs from what the job's results were made from, it is stored, the
 * total plan is dropped and the sweep re-runs; the old sweep's configurations are no longer listed.
 * A part sent without an outline never replaces the same part with one. No `version`: it is the
 * part's facts, not an edit, and it never conflicts with one.
 */
export const PutJobPartRequestSchema = z.object({ part: json });
export type PutJobPartRequest = z.infer<typeof PutJobPartRequestSchema>;

export const PutJobPartResponseSchema = z.object({
  job: JobSchema,
  /** True when the job is now designed from this part (and re-sweeps); false when it already was. */
  changed: z.boolean(),
});
export type PutJobPartResponse = z.infer<typeof PutJobPartResponseSchema>;

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
