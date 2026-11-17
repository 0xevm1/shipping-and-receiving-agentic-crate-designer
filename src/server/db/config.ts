/**
 * Where the database is. `DATABASE_URL` wins when set (a hosted Postgres, CI); otherwise the URL
 * is built from the same `DB_PORT` / `DB_NAME` overrides that `docker-compose.yml` reads, so a
 * worktree that changes the port or database name only has to set those (docs/POSTGRES.md).
 *
 * No `server-only` here: the migration scripts and drizzle.config.ts import it outside Next.js.
 */

/** Matches `docker-compose.yml`. Local-only credentials; never use them for a hosted database. */
export const LOCAL_DB = { host: "localhost", port: 5432, user: "crate", password: "crate", name: "crate_designer" } as const;

type Env = Readonly<Record<string, string | undefined>>;

export function databaseUrl(env: Env = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const port = env.DB_PORT || String(LOCAL_DB.port);
  const name = env.DB_NAME || LOCAL_DB.name;
  return `postgres://${LOCAL_DB.user}:${LOCAL_DB.password}@${LOCAL_DB.host}:${port}/${name}`;
}

/** The same server with another database name (the maintenance `postgres` db, a test db). */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** The database name in a connection URL. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/**
 * Loads `.env.local` then `.env` into `process.env` without overriding what's already set, for
 * tools that don't do it themselves (vitest, drizzle-kit). Next.js and bun load them already.
 */
export function loadLocalEnv(dir = process.cwd()): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(`${dir}/${file}`);
    } catch {
      // No such file: nothing to load.
    }
  }
}
