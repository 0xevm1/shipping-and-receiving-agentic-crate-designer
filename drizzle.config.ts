// drizzle-kit (#46): `bun run db:generate` diffs src/server/db/schema.ts against the snapshots in
// db/migrations/meta and writes the next SQL migration. Migrations are applied by
// `bun run db:migrate` (src/server/db/migrate.ts), not by drizzle-kit.
import { defineConfig } from "drizzle-kit";
import { databaseUrl, loadLocalEnv } from "./src/server/db/config";

loadLocalEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: databaseUrl() },
  strict: true,
  verbose: true,
});
