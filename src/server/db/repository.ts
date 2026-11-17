/**
 * The org-scoped repository (#46). Every method takes an `OrgContext` first and filters (or
 * stamps) `org_id` from it, so application code has no way to query across orgs. Code outside
 * this file should not use the drizzle handle directly; add a method here instead.
 */
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type OrgContext, requireOrg } from "./org";
import * as schema from "./schema";
import { artifact, configuration, designJob, event, part, partModel } from "./schema";

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
      async get(ctx: OrgContext, id: string): Promise<DesignJob | undefined> {
        const orgId = requireOrg(ctx);
        const [row] = await db
          .select()
          .from(designJob)
          .where(and(eq(designJob.orgId, orgId), eq(designJob.id, id)));
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
      async listForJob(ctx: OrgContext, jobId: string): Promise<Configuration[]> {
        const orgId = requireOrg(ctx);
        return db
          .select()
          .from(configuration)
          .where(and(eq(configuration.orgId, orgId), eq(configuration.jobId, jobId)))
          .orderBy(asc(configuration.createdAt), asc(configuration.id));
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
