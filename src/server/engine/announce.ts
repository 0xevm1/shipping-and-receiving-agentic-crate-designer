/**
 * Server start (#46 §3): tell open tabs when this process runs an engine they don't, and queue
 * the sweep for every job whose total-quantity plan came from another engine (spec §7.16). Called from
 * `src/instrumentation.ts`. Opens its own one-connection client and closes it, rather than the
 * app's pool (`db/client.ts` is `server-only`, which instrumentation can't load), and never throws:
 * a database that is down at start only means no announcement. Old tabs still learn of the new
 * engine from the `409 engine_version_mismatch` on their next save.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ENGINE_VERSION } from "@/engine/version";
import { databaseUrl } from "../db/config";
import { announceEngineVersion, type EngineAnnouncement } from "../db/engineRelease";
import * as schema from "../db/schema";
import { replanTotals } from "../queue/jobs";

export async function announceEngineOnStart(engineVersion = ENGINE_VERSION, url = databaseUrl()): Promise<EngineAnnouncement | null> {
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    // A new engine re-plans every job's total: plans from the old engine are never served as current.
    const result = await announceEngineVersion(drizzle({ client: sql, schema }), engineVersion, (repo, ctx) => replanTotals(repo, ctx, engineVersion));
    if (result.announced) console.log(`engine ${engineVersion}: first start, engine.updated sent to ${result.orgs} org(s)`);
    return result;
  } catch (e) {
    console.warn(`engine ${engineVersion}: couldn't record the engine version (no engine.updated sent):`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
