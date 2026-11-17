/**
 * Applies `db/migrations/` to a database, creating the database first if it doesn't exist (so a
 * worktree's `DB_NAME` override needs no manual setup). Used by `bun run db:migrate` and the
 * integration tests; not imported by the app.
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseName, withDatabase } from "./config";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Runs `fn` on a one-connection client to the server's maintenance database. */
async function withAdmin<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(withDatabase(url, "postgres"), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function ensureDatabase(url: string): Promise<boolean> {
  const name = databaseName(url);
  return withAdmin(url, async (sql) => {
    const [found] = await sql`select 1 from pg_database where datname = ${name}`;
    if (found) return false;
    await sql.unsafe(`create database ${quoteIdent(name)}`);
    return true;
  });
}

export async function dropDatabase(url: string): Promise<void> {
  const name = databaseName(url);
  await withAdmin(url, (sql) => sql.unsafe(`drop database if exists ${quoteIdent(name)} with (force)`));
}

export async function migrateDatabase(url: string): Promise<void> {
  await ensureDatabase(url);
  // drizzle's migrator needs a single connection (postgres.js docs: `max: 1`).
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle({ client: sql }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
