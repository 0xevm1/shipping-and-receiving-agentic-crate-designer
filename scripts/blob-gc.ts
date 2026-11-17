// Orphan cleanup for blob storage (#46 §2a), behind `bun run blob:gc`: deletes objects under
// org/<orgId>/ that no metadata row names and that are older than 24 h (src/server/blob/gc.ts).
//
//   bun run blob:gc                       delete orphans older than 24 h
//   bun run blob:gc -- --dry-run          list them only
//   bun run blob:gc -- --older-than-hours=48
//
// Reads BLOB_* and DATABASE_URL (or DB_PORT / DB_NAME) from the shell, .env.local or .env.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { blobConfig } from "../src/server/blob/config";
import { collectOrphans, ORPHAN_AGE_MS } from "../src/server/blob/gc";
import { createS3BlobStore } from "../src/server/blob/s3";
import { databaseUrl } from "../src/server/db/config";
import { createRepository } from "../src/server/db/repository";
import * as schema from "../src/server/db/schema";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const dryRun = args.includes("--dry-run");
const hoursArg = args.find((a) => a.startsWith("--older-than-hours="));
const hours = hoursArg ? Number(hoursArg.split("=")[1]) : ORPHAN_AGE_MS / 3_600_000;
if (!(hours >= 1)) {
  console.error("blob:gc: --older-than-hours must be at least 1, so in-flight uploads are never deleted.");
  process.exit(1);
}

const config = blobConfig();
const sql = postgres(databaseUrl(), { max: 2, onnotice: () => {} });
try {
  const result = await collectOrphans({
    store: createS3BlobStore(config),
    repo: createRepository(drizzle({ client: sql, schema })),
    olderThanMs: hours * 3_600_000,
    dryRun,
  });
  for (const key of result.orphans) console.log(`${dryRun ? "would delete" : "deleted"} ${key}`);
  console.log(
    `blob:gc: bucket ${config.bucket}: scanned ${result.scanned}, ${result.orphans.length} orphan(s) older than ${hours} h` +
      (dryRun ? " (dry run, nothing deleted)" : `, deleted ${result.deleted}`),
  );
} finally {
  await sql.end({ timeout: 5 });
}
