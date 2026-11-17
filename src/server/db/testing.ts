/**
 * Integration-test helpers: a throwaway, migrated database on the compose Postgres. Only the
 * `*.integration.test.ts` files import this.
 */
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseName, databaseUrl, withDatabase } from "./config";
import { dropDatabase, migrateDatabase } from "./migrate";
import { createRepository, type Database, type Repository } from "./repository";
import * as schema from "./schema";
import { createSystemQueries, type SystemQueries } from "./system";

export type TestDatabase = { url: string; sql: postgres.Sql; db: Database; repo: Repository; system: SystemQueries; drop(): Promise<void> };

/** The URL of a new, uniquely named database next to the configured one (not yet created). */
export function scratchDatabaseUrl(label: string): string {
  const base = databaseUrl();
  return withDatabase(base, `${databaseName(base)}_it_${label}_${randomBytes(4).toString("hex")}`);
}

/** Creates and migrates a scratch database and opens a pool on it. `drop()` closes and removes it. */
export async function createTestDatabase(label: string): Promise<TestDatabase> {
  const url = scratchDatabaseUrl(label);
  await migrateDatabase(url);
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  const db = drizzle({ client: sql, schema });
  return {
    url,
    sql,
    db,
    repo: createRepository(db),
    system: createSystemQueries(db),
    async drop() {
      await sql.end({ timeout: 5 });
      await dropDatabase(url);
    },
  };
}
