// Local infrastructure commands (#46), behind the `infra:*` and `db:*` package scripts:
//
//   bun scripts/infra.ts up        docker compose up -d --wait, then wait for the bucket setup
//   bun scripts/infra.ts down ...  docker compose down (extra args pass through, e.g. -v)
//   bun scripts/infra.ts migrate   create the database if missing and apply db/migrations
//   bun scripts/infra.ts reset     drop the database, then migrate (wipes its data)
//   bun scripts/infra.ts psql      psql in the db container, on DB_NAME
//
// Bun loads .env and .env.local first, so COMPOSE_PROJECT_NAME, DB_PORT, DB_NAME, BLOB_PORT and
// BLOB_CONSOLE_PORT set there reach both docker compose and the database URL (docs/POSTGRES.md).
import { spawnSync } from "node:child_process";
import { databaseName, databaseUrl } from "../src/server/db/config";
import { dropDatabase, migrateDatabase } from "../src/server/db/migrate";

function compose(args: string[], quiet = false): void {
  const { status, error } = spawnSync("docker", ["compose", ...args], { stdio: quiet ? "ignore" : "inherit" });
  if (error) fail(`docker compose ${args[0]}: ${error.message}. Is Docker installed and running?`);
  if (status !== 0) fail(`docker compose ${args.join(" ")} exited with ${status}.`);
}

function fail(message: string): never {
  console.error(`infra: ${message}`);
  process.exit(1);
}

/** The database URL with the password masked, for logs. */
function shown(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}

const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--");
const url = databaseUrl();

switch (command) {
  case "up": {
    compose(["up", "-d", "--wait"]);
    // `--wait` doesn't wait for one-shot services to finish; `wait` does and returns their status.
    compose(["wait", "blob-init"], true);
    const blobPort = process.env.BLOB_PORT || "9000";
    const consolePort = process.env.BLOB_CONSOLE_PORT || "9001";
    console.log(
      [
        "",
        "infra: up",
        `  Postgres       ${shown(url)}`,
        `  S3 endpoint    http://localhost:${blobPort}  (buckets crate-designer-dev, crate-designer-test)`,
        `  Blob console   http://localhost:${consolePort}`,
        "",
      ].join("\n"),
    );
    break;
  }
  case "down":
    compose(["down", ...rest]);
    break;
  case "migrate":
    try {
      await migrateDatabase(url);
    } catch (e) {
      fail(`migrating ${shown(url)} failed: ${(e as Error).message}. Is it up (bun run infra:up)?`);
    }
    console.log(`infra: ${databaseName(url)} is migrated`);
    break;
  case "reset":
    await dropDatabase(url);
    await migrateDatabase(url);
    console.log(`infra: ${databaseName(url)} was dropped and migrated`);
    break;
  case "psql":
    compose(["exec", "db", "psql", "-U", "crate", "-d", databaseName(url), ...rest]);
    break;
  default:
    fail(`unknown command ${JSON.stringify(command)}; use up, down, migrate, reset or psql.`);
}
