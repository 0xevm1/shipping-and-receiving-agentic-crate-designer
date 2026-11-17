/**
 * Postgres schema (#46, slice 1). The source of truth for `db/migrations/`: change a table here,
 * then `bun run db:generate` writes the migration. CI fails when the two disagree.
 *
 * Org scoping: every root table has `org_id`, and every child points at its parent through a
 * composite `(org_id, <parent>_id)` foreign key, so a row can never reference another org's row.
 * Content-addressed keys (`part_model.sha256`, `configuration.input_hash`) are unique per org,
 * never globally, so one org can't probe whether another has stored the same bytes.
 * Queries go through the org-scoped repository (`repository.ts`), which needs an `OrgContext`.
 * Row-level security is deferred until a second org shares a deployment (see docs/POSTGRES.md).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  type PgTableExtraConfigValue,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => org.id);

/** An organisation. The prototype has one, seeded by the first migration (`DEFAULT_ORG_ID`). */
export const org = pgTable("org", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const PART_SOURCES = ["catalog", "upload"] as const;
export type PartSource = (typeof PART_SOURCES)[number];

/** A part to crate: physical properties in mm / kg (spec §4), and the GLB it came from, if any. */
export const part = pgTable(
  "part",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    material: text("material"),
    densityKgM3: doublePrecision("density_kg_m3"),
    massKg: doublePrecision("mass_kg").notNull(),
    sizeXMm: doublePrecision("size_x_mm").notNull(),
    sizeYMm: doublePrecision("size_y_mm").notNull(),
    sizeZMm: doublePrecision("size_z_mm").notNull(),
    /** sha256 of the GLB in `part_model`; null for a part with no model. */
    modelSha256: text("model_sha256"),
    source: text("source").$type<PartSource>().notNull(),
    /** The catalog entry (`src/data/parts.json` id) a `catalog` part was registered from; one row per org and id. */
    catalogId: text("catalog_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("part_org_id_id_key").on(t.orgId, t.id),
    uniqueIndex("part_org_catalog_id_key")
      .on(t.orgId, t.catalogId)
      .where(sql`${t.catalogId} is not null`),
    index("part_org_model_idx").on(t.orgId, t.modelSha256),
    index("part_org_id_idx").on(t.orgId, t.createdAt),
    foreignKey({
      name: "part_model_fk",
      columns: [t.orgId, t.modelSha256],
      foreignColumns: [partModel.orgId, partModel.sha256],
    }),
    check("part_source_check", sql`${t.source} in ('catalog', 'upload')`),
    check("part_mass_positive", sql`${t.massKg} > 0`),
    check("part_catalog_id_check", sql`${t.catalogId} is null or ${t.source} = 'catalog'`),
  ],
);

/** GLB metadata by content hash. The bytes live in blob storage (slice 1a), never in Postgres. */
export const partModel = pgTable(
  "part_model",
  {
    orgId: orgId(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Blob key, `org/<orgId>/models/<sha256>.glb`. */
    objectKey: text("object_key").notNull(),
    /** How the upload was checked (binary GLB, no Draco / Meshopt, size limit, ...). */
    validation: jsonb("validation").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: "part_model_pkey", columns: [t.orgId, t.sha256] })],
);

export const DESIGN_JOB_STATUSES = ["open", "running", "ready", "error", "archived"] as const;
export type DesignJobStatus = (typeof DESIGN_JOB_STATUSES)[number];

/**
 * One per part being crated. Mutable fields (status, selection, notes) use optimistic
 * concurrency: an update names the `version` it read and bumps it; a stale version updates nothing.
 */
export const designJob = pgTable(
  "design_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    partId: uuid("part_id").notNull(),
    totalQuantity: integer("total_quantity"),
    createdBy: text("created_by"),
    status: text("status").$type<DesignJobStatus>().notNull().default("open"),
    /**
     * One of this job's configurations: the composite FK below points at `job_configuration`, so
     * a job can only select a configuration linked to it. Configurations are never deleted.
     */
    selectedConfigurationId: uuid("selected_configuration_id"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Annotated: design_job and configuration reference each other, which TypeScript can't infer.
  (t): PgTableExtraConfigValue[] => [
    unique("design_job_org_id_id_key").on(t.orgId, t.id),
    index("design_job_org_id_idx").on(t.orgId, t.createdAt),
    foreignKey({ name: "design_job_part_fk", columns: [t.orgId, t.partId], foreignColumns: [part.orgId, part.id] }),
    foreignKey({
      name: "design_job_selected_configuration_fk",
      columns: [t.orgId, t.id, t.selectedConfigurationId],
      foreignColumns: [jobConfiguration.orgId, jobConfiguration.jobId, jobConfiguration.configurationId],
    }),
    check("design_job_status_check", sql`${t.status} in ('open', 'running', 'ready', 'error', 'archived')`),
    check("design_job_total_positive", sql`${t.totalQuantity} is null or ${t.totalQuantity} > 0`),
  ],
);

export const CONFIGURATION_ORIGINS = ["precomputed", "user"] as const;
export type ConfigurationOrigin = (typeof CONFIGURATION_ORIGINS)[number];

/**
 * A crate configuration, content-addressed by the engine's `inputHash` (unique per org). Rows are
 * never updated: saving the same inputs twice finds the existing row. Not owned by a job: two jobs
 * that reach the same inputs share the row, and `job_configuration` links them (#46 slice 5).
 */
export const configuration = pgTable(
  "configuration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    inputHash: text("input_hash").notNull(),
    quantityPerCrate: integer("quantity_per_crate").notNull(),
    layout: text("layout").notNull(),
    /**
     * The engine's whole `DesignRequest` (part design fields, settings, standards, layout pick,
     * ranking), so the server can recompute it; validated with `DesignRequestSchema` on read.
     */
    settings: jsonb("settings").$type<unknown>().notNull(),
    /** The engine's `DesignSummary` for those inputs, as the server recomputed it. */
    resultSummary: jsonb("result_summary").$type<unknown>(),
    /** Crate cost per part in USD (lower is better); null when there is no crate. */
    score: doublePrecision("score"),
    engineVersion: text("engine_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("configuration_org_id_id_key").on(t.orgId, t.id),
    unique("configuration_org_id_input_hash_key").on(t.orgId, t.inputHash),
    check("configuration_quantity_positive", sql`${t.quantityPerCrate} > 0`),
  ],
);

/**
 * Which configurations a job has, and how each got there (`precomputed` by a sweep, or saved by
 * a `user`). One row per job and configuration, so saving the same configuration twice is one link.
 */
export const jobConfiguration = pgTable(
  "job_configuration",
  {
    orgId: orgId(),
    jobId: uuid("job_id").notNull(),
    configurationId: uuid("configuration_id").notNull(),
    origin: text("origin").$type<ConfigurationOrigin>().notNull(),
    createdAt: createdAt(),
  },
  // Annotated: design_job and job_configuration reference each other.
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: "job_configuration_pkey", columns: [t.orgId, t.jobId, t.configurationId] }),
    index("job_configuration_job_idx").on(t.orgId, t.jobId, t.createdAt),
    foreignKey({ name: "job_configuration_job_fk", columns: [t.orgId, t.jobId], foreignColumns: [designJob.orgId, designJob.id] }),
    foreignKey({
      name: "job_configuration_configuration_fk",
      columns: [t.orgId, t.configurationId],
      foreignColumns: [configuration.orgId, configuration.id],
    }),
    check("job_configuration_origin_check", sql`${t.origin} in ('precomputed', 'user')`),
  ],
);

export const ARTIFACT_KINDS = ["glb", "pdf", "csv", "zip"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const ARTIFACT_BUILDERS = ["browser", "server"] as const;
export type ArtifactBuilder = (typeof ARTIFACT_BUILDERS)[number];

/**
 * A generated file. Bytes in blob storage; this row holds the key, which is content-addressed
 * (`org/<orgId>/artifacts/<inputHash>/<engineVersion>/<file>`, `org/<orgId>/bundles/<id>.zip`), so
 * the key is the identity: one row per object, whichever engine version or bundle made it (#46
 * slice 6, docs/API.md "Artifacts"). A bundle (`zip`) spans several configurations; its row names
 * the first one, so a job's snapshot lists it and orphan cleanup keeps its object.
 */
export const artifact = pgTable(
  "artifact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    configurationId: uuid("configuration_id").notNull(),
    kind: text("kind").$type<ArtifactKind>().notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    objectKey: text("object_key").notNull(),
    builtBy: text("built_by").$type<ArtifactBuilder>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("artifact_org_object_key_key").on(t.orgId, t.objectKey),
    index("artifact_org_configuration_idx").on(t.orgId, t.configurationId),
    foreignKey({
      name: "artifact_configuration_fk",
      columns: [t.orgId, t.configurationId],
      foreignColumns: [configuration.orgId, configuration.id],
    }),
    check("artifact_kind_check", sql`${t.kind} in ('glb', 'pdf', 'csv', 'zip')`),
    check("artifact_built_by_check", sql`${t.builtBy} in ('browser', 'server')`),
  ],
);

/**
 * Append-only outbox of things clients care about. The ids give the order for SSE replay
 * (`id > Last-Event-ID`). The NOTIFY trigger and LISTEN hub come with the event slice (#46 slice 2).
 */
export const event = pgTable(
  "event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: orgId(),
    jobId: uuid("job_id"),
    type: text("type").notNull(),
    /** Small: clients fetch details by id. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("event_org_job_id_idx").on(t.orgId, t.jobId, t.id),
    foreignKey({ name: "event_job_fk", columns: [t.orgId, t.jobId], foreignColumns: [designJob.orgId, designJob.id] }),
  ],
);

/** Shop rates and limits (#19), versioned per org; one source for browser and server. */
export const shopStandard = pgTable(
  "shop_standard",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    version: integer("version").notNull(),
    standards: jsonb("standards").$type<unknown>().notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [unique("shop_standard_org_version_key").on(t.orgId, t.version)],
);

/**
 * Engine versions this deployment has run (#46 §3, docs/POSTGRES.md "Engine updates"). Server-wide,
 * not org data. The first server process to start on a version inserts its row and, in the same
 * transaction, emits one org-wide `engine.updated` per org; the primary key makes that happen once
 * per version however many instances start at the same moment (src/server/db/engineRelease.ts).
 */
export const engineRelease = pgTable("engine_release", {
  engineVersion: text("engine_version").primaryKey(),
  firstStartedAt: timestamp("first_started_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Client-generated ids of changes already applied, so an offline replay (#46 slice 7a) that
 * sends a change twice applies it once. The stored response is returned for the repeat.
 */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    orgId: orgId(),
    key: text("key").notNull(),
    /** Hash of the request body, so the same key with a different body can be refused. */
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: "idempotency_key_pkey", columns: [t.orgId, t.key] })],
);

export const QUEUE_JOB_STATUSES = ["queued", "running", "done", "dead"] as const;
export type QueueJobStatus = (typeof QUEUE_JOB_STATUSES)[number];

/**
 * The background job queue (#46 slice 7, docs/QUEUE.md): Postgres, not Redis. Workers claim the
 * oldest due row with `SELECT … FOR UPDATE SKIP LOCKED`, woken by `NOTIFY crate_jobs` with a
 * polling fallback. A claimed row is leased until `locked_until`; a worker that crashes stops
 * renewing it and the row is claimed again once the lease runs out. A failed attempt goes back to
 * `queued` with exponential backoff (`run_at`) until `max_attempts`, then to `dead` (dead letter).
 * Single FIFO for now; `org_id` is kept so fair scheduling between orgs can be added (deferred, #60).
 */
export const queueJob = pgTable(
  "queue_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    /** What to run: `sweep`, `bundle`, … (src/server/queue/handlers.ts). */
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<QueueJobStatus>().notNull().default("queued"),
    /** Claims so far, including the one running. */
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** Not claimed before this (backoff after a failure). */
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    /** The running claim's lease; past it, the job is claimable again (the worker died). */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: text("locked_by"),
    /** At most one queued-or-running job per (org, kind, dedupe key): enqueueing again is a no-op. */
    dedupeKey: text("dedupe_key"),
    lastError: text("last_error"),
    result: jsonb("result").$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("queue_job_org_id_id_key").on(t.orgId, t.id),
    // The claim's scan: due queued jobs, and running ones whose lease ran out, oldest first.
    index("queue_job_claim_idx")
      .on(t.runAt, t.createdAt)
      .where(sql`${t.status} in ('queued', 'running')`),
    uniqueIndex("queue_job_dedupe_key")
      .on(t.orgId, t.kind, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} in ('queued', 'running')`),
    check("queue_job_status_check", sql`${t.status} in ('queued', 'running', 'done', 'dead')`),
    check("queue_job_max_attempts_positive", sql`${t.maxAttempts} > 0`),
  ],
);

/**
 * API keys for clients other than the UI (#46 slice 7, docs/QUEUE.md "API keys"): the CLI, ERP
 * and batch scripts send `Authorization: Bearer <key>`. Only the SHA-256 of a key is stored; the
 * key itself is shown once, by `bun run apikey:create`. A revoked key is refused.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    /** The key's first characters ("cdk_AbC123"), to recognise it in a list. Not secret. */
    prefix: text("prefix").notNull(),
    /** SHA-256 (hex) of the whole key. Keys are 256-bit random, so a fast hash is enough. */
    keyHash: text("key_hash").notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_key_org_id_idx").on(t.orgId, t.createdAt)],
);
