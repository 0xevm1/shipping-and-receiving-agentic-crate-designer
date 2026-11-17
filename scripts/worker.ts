// The queue worker (#46 slice 7, docs/QUEUE.md), behind `bun run worker`: claims jobs from the
// Postgres queue (`queue_job`) and runs them, with the engine work on a worker_threads pool.
// Run as many as you like (on one machine or several): `FOR UPDATE SKIP LOCKED` keeps them apart.
//
//   bun run worker                         one worker, QUEUE_CONCURRENCY jobs at once (default 2)
//
// Reads DATABASE_URL (or DB_PORT / DB_NAME), QUEUE_CONCURRENCY, QUEUE_POLL_MS, QUEUE_LEASE_MS,
// ENGINE_POOL_SIZE and ENGINE_WORKER_PATH from the shell, .env.local or .env. Stops cleanly on
// SIGINT / SIGTERM: claims nothing new and lets running jobs finish.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "../src/server/db/config";
import { createQueueStore } from "../src/server/db/queue";
import * as schema from "../src/server/db/schema";
import { createJobHandlers, createOnDead } from "../src/server/queue/jobs";
import { pgQueueListen } from "../src/server/queue/listen";
import { createQueueRunner } from "../src/server/queue/runner";
import { createEnginePool } from "../src/server/workers/engine";

const num = (v: string | undefined, fallback: number) => (Number(v) > 0 ? Number(v) : fallback);

const url = databaseUrl();
const sql = postgres(url, { max: 4, onnotice: () => {} });
const db = drizzle({ client: sql, schema });
const pool = createEnginePool();
const runner = createQueueRunner({
  store: createQueueStore(db),
  handlers: createJobHandlers({ db, pool }),
  onDead: createOnDead(db),
  listen: pgQueueListen(url),
  concurrency: num(process.env.QUEUE_CONCURRENCY, 2),
  pollIntervalMs: num(process.env.QUEUE_POLL_MS, 5_000),
  leaseMs: num(process.env.QUEUE_LEASE_MS, 60_000),
});

await runner.start();
console.log(`worker: ${runner.workerId} listening on crate_jobs, ${pool.stats().threads} engine threads started on demand`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`worker: ${signal}, finishing running jobs`);
  await runner.stop();
  await pool.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
