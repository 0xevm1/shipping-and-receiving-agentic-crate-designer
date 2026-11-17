/**
 * The org-scoped repository (#46). Every method takes an `OrgContext` first and filters (or
 * stamps) `org_id` from it, so application code has no way to query across orgs. Code outside
 * this file should not use the drizzle handle directly; add a method here instead.
 */
import { and, asc, desc, eq, gt, inArray, isNull, max, ne, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type OrgContext, requireOrg } from "./org";
import { createQueueStore } from "./queue";
import * as schema from "./schema";
import { artifact, type ConfigurationOrigin, configuration, designJob, event, idempotencyKey, jobConfiguration, part, partModel } from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export type Part = typeof part.$inferSelect;
export type NewPart = Omit<typeof part.$inferInsert, "orgId" | "id" | "createdAt">;
export type PartModel = typeof partModel.$inferSelect;
export type NewPartModel = Omit<typeof partModel.$inferInsert, "orgId" | "createdAt">;
export type DesignJob = typeof designJob.$inferSelect;
export type NewDesignJob = Pick<typeof designJob.$inferInsert, "partId" | "totalQuantity" | "createdBy" | "notes">;
export type DesignJobPatch = Partial<Pick<DesignJob, "status" | "selectedConfigurationId" | "notes" | "totalQuantity">>;
export type Configuration = typeof configuration.$inferSelect;
export type NewConfiguration = Omit<typeof configuration.$inferInsert, "orgId" | "id" | "createdAt">;
/** A configuration as a job sees it: the content-addressed row plus how it joined this job. */
export type JobConfiguration = Configuration & { origin: ConfigurationOrigin; addedAt: Date };
export type Artifact = typeof artifact.$inferSelect;
export type NewArtifact = Omit<typeof artifact.$inferInsert, "orgId" | "id" | "createdAt">;
export type IdempotencyRecord = typeof idempotencyKey.$inferSelect;
export type CrateEvent = typeof event.$inferSelect;
export type NewCrateEvent = Pick<typeof event.$inferInsert, "jobId" | "type" | "payload">;

/** Advisory lock key that orders event commits (`events.append`). Any constant works; it spells "crate". */
export const EVENT_ORDER_LOCK = 0x6372617465;

function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("Expected a row, got none.");
  return row;
}

export function createRepository(db: Executor) {
  async function jobConfigurations(orgId: string, jobId: string, configurationId?: string): Promise<JobConfiguration[]> {
    const rows = await db
      .select({ configuration, origin: jobConfiguration.origin, addedAt: jobConfiguration.createdAt })
      .from(jobConfiguration)
      .innerJoin(configuration, and(eq(configuration.orgId, jobConfiguration.orgId), eq(configuration.id, jobConfiguration.configurationId)))
      .where(
        and(
          eq(jobConfiguration.orgId, orgId),
          eq(jobConfiguration.jobId, jobId),
          configurationId ? eq(jobConfiguration.configurationId, configurationId) : undefined,
        ),
      )
      .orderBy(asc(jobConfiguration.createdAt), asc(configuration.id));
    return rows.map((r) => ({ ...r.configuration, origin: r.origin, addedAt: r.addedAt }));
  }

  return {
    parts: {
      async create(ctx: OrgContext, input: NewPart): Promise<Part> {
        const orgId = requireOrg(ctx);
        return one(
          await db
            .insert(part)
            .values({ ...input, orgId })
            .returning(),
        );
      },
      async get(ctx: OrgContext, id: string): Promise<Part | undefined> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .select()
          .from(part)
          .where(and(eq(part.orgId, orgId), eq(part.id, id)));
        return row;
      },
      async list(ctx: OrgContext): Promise<Part[]> {
        const orgId = requireOrg(ctx);
        return db.select().from(part).where(eq(part.orgId, orgId)).orderBy(asc(part.createdAt), asc(part.id));
      },
      /**
       * The org's part for a catalog entry, creating it the first time (`created: true`). One row
       * per (org, catalogId), so concurrent first loads agree on the part.
       */
      async ensureCatalog(ctx: OrgContext, input: NewPart & { catalogId: string }): Promise<{ row: Part; created: boolean }> {
        const orgId = requireOrg(ctx);
        const inserted = await db
          .insert(part)
          .values({ ...input, source: "catalog", orgId })
          .onConflictDoNothing()
          .returning();
        if (inserted[0]) return { row: inserted[0], created: true };
        const [row] = await db
          .select()
          .from(part)
          .where(and(eq(part.orgId, orgId), eq(part.catalogId, input.catalogId)));
        return { row: row!, created: false };
      },
    },

    partModels: {
      /** Content-addressed: storing the same sha256 twice keeps the first row. */
      async put(ctx: OrgContext, input: NewPartModel): Promise<{ row: PartModel; created: boolean }> {
        const orgId = requireOrg(ctx);
        const inserted = await db
          .insert(partModel)
          .values({ ...input, orgId })
          .onConflictDoNothing()
          .returning();
        if (inserted[0]) return { row: inserted[0], created: true };
        const [row] = await db
          .select()
          .from(partModel)
          .where(and(eq(partModel.orgId, orgId), eq(partModel.sha256, input.sha256)));
        return { row: row!, created: false };
      },
      async get(ctx: OrgContext, sha256: string): Promise<PartModel | undefined> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .select()
          .from(partModel)
          .where(and(eq(partModel.orgId, orgId), eq(partModel.sha256, sha256)));
        return row;
      },
    },

    jobs: {
      async create(ctx: OrgContext, input: NewDesignJob): Promise<DesignJob> {
        const orgId = requireOrg(ctx);
        return one(
          await db
            .insert(designJob)
            .values({ ...input, orgId })
            .returning(),
        );
      },
      /** With `forUpdate`, locks the row until the transaction ends (read, check, then update). */
      async get(ctx: OrgContext, id: string, { forUpdate = false } = {}): Promise<DesignJob | undefined> {
        const orgId = requireOrg(ctx);
        const query = db
          .select()
          .from(designJob)
          .where(and(eq(designJob.orgId, orgId), eq(designJob.id, id)));
        const [row] = forUpdate ? await query.for("update") : await query;
        return row;
      },
      /**
       * Optimistic concurrency: applies `patch` only if the job is still at `expectedVersion`,
       * and bumps the version. Returns the updated job, or `undefined` when the version was stale
       * (or the job isn't this org's); the API answers that with 409.
       */
      async update(ctx: OrgContext, id: string, expectedVersion: number, patch: DesignJobPatch): Promise<DesignJob | undefined> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .update(designJob)
          .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
          .where(and(eq(designJob.orgId, orgId), eq(designJob.id, id), eq(designJob.version, expectedVersion)))
          .returning();
        return row;
      },
      /**
       * The newest job that isn't archived for the same part: the part itself, the same catalog
       * entry, or an upload of the same GLB (by sha256). Lets two tabs that load the same part
       * meet on one job instead of opening one each.
       */
      async findReusable(ctx: OrgContext, of: Part): Promise<DesignJob | undefined> {
        const orgId = requireOrg(ctx);
        const samePart = or(
          eq(part.id, of.id),
          of.catalogId ? eq(part.catalogId, of.catalogId) : undefined,
          of.modelSha256 && of.source === "upload" ? and(eq(part.modelSha256, of.modelSha256), eq(part.source, "upload")) : undefined,
        );
        const [row] = await db
          .select({ job: designJob })
          .from(designJob)
          .innerJoin(part, and(eq(part.orgId, designJob.orgId), eq(part.id, designJob.partId)))
          .where(and(eq(designJob.orgId, orgId), ne(designJob.status, "archived"), samePart))
          .orderBy(desc(designJob.createdAt), desc(designJob.id))
          .limit(1);
        return row?.job;
      },
      /**
       * A transaction-level advisory lock on `key` within the org (e.g. a part id), so "find or
       * create" runs one at a time per key. Only meaningful inside a transaction.
       */
      async lock(ctx: OrgContext, key: string): Promise<void> {
        const orgId = requireOrg(ctx);
        await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${orgId}:${key}`}, 0))`);
      },
    },

    configurations: {
      /**
       * Content-addressed by `(org, inputHash)`: saving the same inputs again returns the
       * existing row (`created: false`) and never overwrites it.
       */
      async save(ctx: OrgContext, input: NewConfiguration): Promise<{ row: Configuration; created: boolean }> {
        const orgId = requireOrg(ctx);
        const inserted = await db
          .insert(configuration)
          .values({ ...input, orgId })
          .onConflictDoNothing({ target: [configuration.orgId, configuration.inputHash] })
          .returning();
        if (inserted[0]) return { row: inserted[0], created: true };
        const [row] = await db
          .select()
          .from(configuration)
          .where(and(eq(configuration.orgId, orgId), eq(configuration.inputHash, input.inputHash)));
        return { row: row!, created: false };
      },
      async getByHash(ctx: OrgContext, inputHash: string): Promise<Configuration | undefined> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .select()
          .from(configuration)
          .where(and(eq(configuration.orgId, orgId), eq(configuration.inputHash, inputHash)));
        return row;
      },
      /**
       * Adds a configuration to a job. One link per (job, configuration): linking again keeps the
       * first link (and its origin) and returns `created: false`.
       */
      async link(ctx: OrgContext, jobId: string, configurationId: string, origin: ConfigurationOrigin): Promise<{ created: boolean }> {
        const orgId = requireOrg(ctx);
        const inserted = await db
          .insert(jobConfiguration)
          .values({ orgId, jobId, configurationId, origin })
          .onConflictDoNothing()
          .returning({ id: jobConfiguration.configurationId });
        return { created: inserted.length > 0 };
      },
      async isLinked(ctx: OrgContext, jobId: string, configurationId: string): Promise<boolean> {
        const orgId = requireOrg(ctx);
        const rows = await db
          .select({ id: jobConfiguration.configurationId })
          .from(jobConfiguration)
          .where(and(eq(jobConfiguration.orgId, orgId), eq(jobConfiguration.jobId, jobId), eq(jobConfiguration.configurationId, configurationId)));
        return rows.length > 0;
      },
      /** A job's configurations, in the order they joined it. */
      async listForJob(ctx: OrgContext, jobId: string): Promise<JobConfiguration[]> {
        return jobConfigurations(requireOrg(ctx), jobId);
      },
      /** One configuration as this job has it, or undefined when it isn't linked to the job. */
      async getForJob(ctx: OrgContext, jobId: string, configurationId: string): Promise<JobConfiguration | undefined> {
        const [row] = await jobConfigurations(requireOrg(ctx), jobId, configurationId);
        return row;
      },
    },

    artifacts: {
      /** The row naming `objectKey` (content-addressed: one row per object). */
      async getByKey(ctx: OrgContext, objectKey: string): Promise<Artifact | undefined> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .select()
          .from(artifact)
          .where(and(eq(artifact.orgId, orgId), eq(artifact.objectKey, objectKey)));
        return row;
      },
      /**
       * Records a stored object. The key is the identity: storing it again (a rebuild after the
       * object expired, a concurrent first build) updates the one row and keeps its id.
       */
      async put(ctx: OrgContext, input: NewArtifact): Promise<Artifact> {
        const orgId = requireOrg(ctx);
        return one(
          await db
            .insert(artifact)
            .values({ ...input, orgId })
            .onConflictDoUpdate({
              target: [artifact.orgId, artifact.objectKey],
              set: { sha256: input.sha256, sizeBytes: input.sizeBytes, builtBy: input.builtBy, createdAt: sql`now()` },
            })
            .returning(),
        );
      },
      /**
       * A transaction-level advisory lock on an object key within the org, so one process at a
       * time builds a missing artifact. Only meaningful inside a transaction.
       */
      async lock(ctx: OrgContext, objectKey: string): Promise<void> {
        const orgId = requireOrg(ctx);
        await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${orgId}:artifact:${objectKey}`}, 0))`);
      },
      /** Generated files of every configuration linked to the job. */
      async listForJob(ctx: OrgContext, jobId: string): Promise<Artifact[]> {
        const orgId = requireOrg(ctx);
        const rows = await db
          .select({ artifact })
          .from(artifact)
          .innerJoin(
            jobConfiguration,
            and(eq(jobConfiguration.orgId, artifact.orgId), eq(jobConfiguration.configurationId, artifact.configurationId), eq(jobConfiguration.jobId, jobId)),
          )
          .where(eq(artifact.orgId, orgId))
          .orderBy(asc(artifact.createdAt), asc(artifact.id));
        return rows.map((r) => r.artifact);
      },
    },

    idempotency: {
      /**
       * Claims `key` for this request inside the caller's transaction. Returns null when the key
       * is new (the caller does the work, then `complete`s it), or the stored record when it was
       * used before. A concurrent request with the same key waits on the row lock until the first
       * commits (and then sees its record) or rolls back (and then claims it itself).
       */
      async claim(ctx: OrgContext, key: string, requestHash: string): Promise<IdempotencyRecord | null> {
        const orgId = requireOrg(ctx);
        const inserted = await db.insert(idempotencyKey).values({ orgId, key, requestHash, statusCode: 0 }).onConflictDoNothing().returning();
        if (inserted.length) return null;
        const [row] = await db
          .select()
          .from(idempotencyKey)
          .where(and(eq(idempotencyKey.orgId, orgId), eq(idempotencyKey.key, key)));
        return row!;
      },
      /** The stored record for `key`, if a request finished with it (read-only: claims nothing). */
      async get(ctx: OrgContext, key: string): Promise<IdempotencyRecord | undefined> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .select()
          .from(idempotencyKey)
          .where(and(eq(idempotencyKey.orgId, orgId), eq(idempotencyKey.key, key)));
        return row;
      },
      async complete(ctx: OrgContext, key: string, statusCode: number, response: unknown): Promise<void> {
        const orgId = requireOrg(ctx);
        await db
          .update(idempotencyKey)
          .set({ statusCode, response })
          .where(and(eq(idempotencyKey.orgId, orgId), eq(idempotencyKey.key, key)));
      },
    },

    events: {
      /**
       * Appends an event; its trigger NOTIFYs `crate_events` when the transaction commits.
       *
       * Takes a transaction-level advisory lock first, so event-writing transactions commit in
       * id order: without it, a transaction holding id 10 could commit after one holding id 11,
       * and a reader that already saw 11 would skip 10 for good (`id > Last-Event-ID`). Inside a
       * caller's transaction (`emitEvent`, `inTransaction`) this runs in a savepoint and the lock
       * is held until that transaction ends, so append the event last.
       */
      async append(ctx: OrgContext, input: NewCrateEvent): Promise<CrateEvent> {
        const orgId = requireOrg(ctx);
        // Database and Transaction both have `transaction` (a transaction, or a savepoint).
        return (db as Database).transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${EVENT_ORDER_LOCK})`);
          return one(
            await tx
              .insert(event)
              .values({ ...input, orgId })
              .returning(),
          );
        });
      },
      /** The newest event id a stream for `jobId` would send (0 when none): a snapshot's resume point. */
      async lastIdForStream(ctx: OrgContext, jobId: string): Promise<number> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .select({ id: max(event.id) })
          .from(event)
          .where(and(eq(event.orgId, orgId), or(eq(event.jobId, jobId), isNull(event.jobId))));
        return Number(row?.id ?? 0);
      },
      /** A job's events after `afterId`, oldest first (SSE catch-up). */
      async listAfter(ctx: OrgContext, jobId: string, afterId = 0, limit = 500): Promise<CrateEvent[]> {
        const orgId = requireOrg(ctx);
        return db
          .select()
          .from(event)
          .where(and(eq(event.orgId, orgId), eq(event.jobId, jobId), gt(event.id, afterId)))
          .orderBy(asc(event.id))
          .limit(limit);
      },
      /**
       * What an SSE stream for `jobId` sends after `afterId`: the job's events and the org's
       * job-less ones (`engine.updated`), oldest first.
       */
      async listForStream(ctx: OrgContext, jobId: string, afterId = 0, limit = 500): Promise<CrateEvent[]> {
        const orgId = requireOrg(ctx);
        return db
          .select()
          .from(event)
          .where(and(eq(event.orgId, orgId), or(eq(event.jobId, jobId), isNull(event.jobId)), gt(event.id, afterId)))
          .orderBy(asc(event.id))
          .limit(limit);
      },
    },

    /** The job queue (#46 slice 7, src/server/db/queue.ts), on this executor: an enqueue inside `inTransaction` commits with it. */
    queue: createQueueStore(db),

    blobRefs: {
      /**
       * Which of `keys` a metadata row (`part_model`, `artifact`) points at, for orphan cleanup
       * (src/server/blob/gc.ts). An object no row names is an orphan.
       */
      async referenced(ctx: OrgContext, keys: string[]): Promise<Set<string>> {
        const orgId = requireOrg(ctx);
        if (keys.length === 0) return new Set();
        const [models, artifacts] = await Promise.all([
          db
            .select({ key: partModel.objectKey })
            .from(partModel)
            .where(and(eq(partModel.orgId, orgId), inArray(partModel.objectKey, keys))),
          db
            .select({ key: artifact.objectKey })
            .from(artifact)
            .where(and(eq(artifact.orgId, orgId), inArray(artifact.objectKey, keys))),
        ]);
        return new Set([...models, ...artifacts].map((r) => r.key));
      },
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

/** Runs `fn` in one transaction, with a repository bound to it (e.g. a write plus its event). */
export function inTransaction<T>(db: Database, fn: (repo: Repository) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(createRepository(tx)));
}
