// What does the event-ordering advisory lock cost? (#46, docs/LOAD_TEST.md "The event-ordering lock")
//
//   bun run load:lock -- --concurrency 1,4,8,16,32 --seconds 5 --work-ms 0,5
//
// `events.append` takes `pg_advisory_xact_lock(EVENT_ORDER_LOCK)` before inserting the event, and
// holds it until commit, so event-writing transactions run their tail one at a time. Postgres
// already serialises commits that NOTIFY (a database-wide lock taken at commit), so the question is
// how much the advisory lock adds on top. This runs the same transaction straight against
// Postgres, `begin; [pg_sleep(work-ms), standing in for the save's own statements]; <tail>; commit`,
// with four tails:
//
//   none     insert into event (… trigger → pg_notify)                  no ordering lock
//   lock     select pg_advisory_xact_lock(…); insert                    the lock, then the insert
//   app      savepoint; lock; insert; release savepoint                 what events.append does today
//                                                                      (drizzle nests it in a savepoint)
//   single   one statement: lock and insert together                    a fix to measure: fewer round
//                                                                      trips while the lock is held
//
// N connections loop for `--seconds` each; it reports event commits per second and the
// transaction latency. The events go to one throwaway job, deleted at the end.
import { parseArgs } from "node:util";
import postgres from "postgres";
import { databaseUrl } from "../../src/server/db/config";
import { EVENT_ORDER_LOCK } from "../../src/server/db/repository";

const now = () => performance.now();
const round = (x: number, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits;
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? Number.NaN;
  return { p50: at(50), p95: at(95) };
}

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    concurrency: { type: "string", default: "1,4,8,16,32" },
    seconds: { type: "string", default: "5" },
    "work-ms": { type: "string", default: "0,5" },
  },
});
const LEVELS = args.concurrency!.split(",").map(Number);
const SECONDS = Number(args.seconds);
const WORK = args["work-ms"]!.split(",").map(Number);

const sql = postgres(databaseUrl(), { max: Math.max(...LEVELS) + 1, connection: { application_name: "crate-load-lock" }, onnotice: () => {} });

type Mode = "none" | "lock" | "app" | "single";
const MODES: Mode[] = ["none", "lock", "app", "single"];

async function run(concurrency: number, mode: Mode, workMs: number, orgId: string, jobId: string) {
  const latencies: number[] = [];
  const end = now() + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (now() < end) {
        const t = now();
        await sql.begin(async (tx) => {
          if (workMs > 0) await tx`select pg_sleep(${workMs / 1000})`;
          if (mode === "none") {
            await tx`insert into event (org_id, job_id, type, payload) values (${orgId}, ${jobId}, 'config.added', '{}'::jsonb)`;
          } else if (mode === "lock") {
            await tx`select pg_advisory_xact_lock(${EVENT_ORDER_LOCK})`;
            await tx`insert into event (org_id, job_id, type, payload) values (${orgId}, ${jobId}, 'config.added', '{}'::jsonb)`;
          } else if (mode === "app") {
            await tx.savepoint(async (sp) => {
              await sp`select pg_advisory_xact_lock(${EVENT_ORDER_LOCK})`;
              await sp`insert into event (org_id, job_id, type, payload) values (${orgId}, ${jobId}, 'config.added', '{}'::jsonb)`;
            });
          } else {
            await tx`with l as (select pg_advisory_xact_lock(${EVENT_ORDER_LOCK}))
                     insert into event (org_id, job_id, type, payload) select ${orgId}, ${jobId}, 'config.added', '{}'::jsonb from l`;
          }
        });
        latencies.push(now() - t);
      }
    }),
  );
  return { perSec: round(latencies.length / SECONDS, 0), ms: summarize(latencies) };
}

const [org] = await sql<{ id: string }[]>`select id from org limit 1`;
const [part] = await sql<{ id: string }[]>`select id from part where org_id = ${org!.id} limit 1`;
if (!part) throw new Error("No part in the database: run `bun run load` (or open the app) once first.");
const [job] = await sql<{ id: string }[]>`insert into design_job (org_id, part_id) values (${org!.id}, ${part.id}) returning id`;
try {
  console.log(`| Work in txn ms | Concurrency | ${MODES.map((m) => `${m}: commits/s (p50 / p95 ms)`).join(" | ")} |`);
  console.log(`|---:|---:|${MODES.map(() => "---|").join("")}`);
  for (const workMs of WORK) {
    for (const c of LEVELS) {
      const cells: string[] = [];
      for (const mode of MODES) {
        const r = await run(c, mode, workMs, org!.id, job!.id);
        cells.push(`${r.perSec} (${round(r.ms.p50, 1)} / ${round(r.ms.p95, 1)})`);
      }
      console.log(`| ${workMs} | ${c} | ${cells.join(" | ")} |`);
    }
  }
} finally {
  await sql`delete from event where job_id = ${job!.id}`;
  await sql`delete from design_job where id = ${job!.id}`;
  await sql.end({ timeout: 1 });
}
