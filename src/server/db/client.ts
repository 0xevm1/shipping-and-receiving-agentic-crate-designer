/**
 * The app's pooled database client. Server-only: importing this from a Client Component fails
 * the build (`server-only`), and eslint keeps src/server out of the lower layers.
 *
 * The pool is created on first use, not at import, so `next build` never needs a database, and
 * kept on `globalThis` so dev-mode hot reloads don't open a new pool each time.
 */
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "./config";
import { createRepository, type Database, type Repository } from "./repository";
import * as schema from "./schema";

type Pool = { sql: postgres.Sql; db: Database; repo: Repository };
const holder = globalThis as typeof globalThis & { __crateDesignerDb?: Pool };

function pool(): Pool {
  if (!holder.__crateDesignerDb) {
    const sql = postgres(databaseUrl(), { max: Number(process.env.DB_POOL_MAX) || 10 });
    const db = drizzle({ client: sql, schema });
    holder.__crateDesignerDb = { sql, db, repo: createRepository(db) };
  }
  return holder.__crateDesignerDb;
}

/** The drizzle handle, for `inTransaction`. Queries belong in the repository. */
export const getDb = (): Database => pool().db;

/** The org-scoped repository on the shared pool. */
export const getRepository = (): Repository => pool().repo;

/** Closes the pool (tests, graceful shutdown). */
export async function closeDb(): Promise<void> {
  const current = holder.__crateDesignerDb;
  holder.__crateDesignerDb = undefined;
  await current?.sql.end({ timeout: 5 });
}
