// Load test for saves and live events (#46, docs/LOAD_TEST.md). Opt-in; not part of CI.
//
//   bun run load -- --base-url http://localhost:3371 --streams 10,100,500,1000 --rates 5,20,50,100
//
// Runs on Node (undici fetch, worker_threads): Bun's fetch reset or refused a few percent of
// 1000 concurrent streaming requests that Node opened cleanly, which would read as server errors.
// The save bodies come from the engine through `bun scripts/load/bodies.ts`.
//
// Against a running `next start` and its Postgres, for each (open streams × saves per second)
// stage of a ramp it:
//   1. opens `--jobs` fresh jobs and spreads the SSE streams over them (worker threads);
//   2. posts engine-made configurations at a fixed rate (open loop: a slow server doesn't slow
//      the senders), round-robin over the jobs, for `--duration` seconds;
//   3. times every `config.added` on every stream against the moment its save was sent, so the
//      latency covers the recompute, commit, NOTIFY, the per-stream table read and SSE;
//   4. samples Postgres (pg_stat_activity, advisory-lock and NOTIFY-lock waiters,
//      pg_notification_queue_usage()) every 250 ms and `/api/v1/health` (event-loop lag) every second;
//   5. runs a "tab A → tab B" canary on its own job: a save every 500 ms, timed to the event on
//      the other tab's stream and to that tab's snapshot re-read (what the browser does next).
// The rate ramp for a stream count stops at the first stage whose p95 passes `--max-p95` or that
// has errors; the whole ramp stops when the lowest rate already fails.
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import postgres from "postgres";
import { now, readEvents } from "./sse.mjs";

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "base-url": { type: "string", default: process.env.LOAD_BASE_URL ?? "http://localhost:3000" },
    streams: { type: "string", default: "10,100,500,1000" },
    rates: { type: "string", default: "5,20,50,100" },
    jobs: { type: "string", default: "20" },
    duration: { type: "string", default: "15" },
    workers: { type: "string", default: "8" },
    grace: { type: "string", default: "10" },
    "max-p95": { type: "string", default: "1000" },
    "pair-saves": { type: "string", default: "40" },
    "keep-going": { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const BASE = args["base-url"].replace(/\/$/, "");
const STREAMS = args.streams.split(",").map(Number);
const RATES = args.rates.split(",").map(Number);
const JOBS = Number(args.jobs);
const DURATION_S = Number(args.duration);
const WORKERS = Number(args.workers);
const GRACE_MS = Number(args.grace) * 1000;
const MAX_P95 = Number(args["max-p95"]);
const PAIR_SAVES = Number(args["pair-saves"]);
const CANARY_INTERVAL_MS = 500;
const OPEN_CONCURRENCY = 96; // Under macOS's default accept backlog (kern.ipc.somaxconn = 128).
const CATALOG_IDS = ["PART-001", "PART-002", "PART-003"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (x, digits = 0) => (Number.isFinite(x) ? Math.round(x * 10 ** digits) / 10 ** digits : x);

/** Nearest-rank percentiles. */
function summarize(values) {
  if (values.length === 0) return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  return { n: sorted.length, p50: at(50), p95: at(95), p99: at(99), max: sorted[sorted.length - 1] };
}

// ---------------------------------------------------------------------------------------------
// Save bodies (and the database URL, with .env.local applied) from the engine, via Bun

function loadBodies(count) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const script = fileURLToPath(new URL("./bodies.ts", import.meta.url));
  const r = spawnSync("bun", [script, String(count)], { cwd: root, encoding: "utf8", maxBuffer: 256 * 2 ** 20 });
  if (r.status !== 0) throw new Error(`bun scripts/load/bodies.ts failed: ${r.stderr || r.error?.message}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------------------------
// HTTP

async function createJob(i) {
  const res = await fetch(`${BASE}/api/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ catalogId: CATALOG_IDS[i % CATALOG_IDS.length], reuse: false }),
  });
  if (res.status !== 201) throw new Error(`POST /jobs: ${res.status} ${await res.text()}`);
  return (await res.json()).job.id;
}

async function save(jobId, body) {
  const sentAt = now();
  try {
    const res = await fetch(`${BASE}/api/v1/jobs/${jobId}/configs`, { method: "POST", headers: { "content-type": "application/json" }, body: body.json });
    const json = await res.json();
    return { jobId, inputHash: body.inputHash, sentAt, ms: now() - sentAt, status: res.status, created: json.created === true };
  } catch (err) {
    return { jobId, inputHash: body.inputHash, sentAt, ms: now() - sentAt, status: 0, created: false, error: err?.cause?.code ?? err?.message };
  }
}

// ---------------------------------------------------------------------------------------------
// Samplers

function startSamplers(sql) {
  const db = [];
  const health = [];
  let running = true;
  const dbLoop = (async () => {
    while (running) {
      const [row] = await sql`
        select count(*)::int as total,
               count(*) filter (where state = 'active')::int as active,
               count(*) filter (where wait_event_type = 'Lock' and wait_event = 'advisory')::int as advisory,
               count(*) filter (where wait_event_type = 'Lock' and wait_event = 'object')::int as notify,
               pg_notification_queue_usage()::float8 as queue
          from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`;
      db.push(row);
      await sleep(250);
    }
  })();
  const healthLoop = (async () => {
    while (running) {
      try {
        const h = await (await fetch(`${BASE}/api/v1/health`)).json();
        if (h.eventLoop) health.push({ p99: h.eventLoop.delayMs.p99, max: h.eventLoop.delayMs.max, utilization: h.eventLoop.utilization });
      } catch {
        // A health request that fails under load shows up as fewer samples.
      }
      await sleep(1000);
    }
  })();
  // A loop, not Math.max(...xs): spreading 100k+ values overflows the call stack.
  const max = (xs) => (xs.length ? xs.reduce((a, b) => (b > a ? b : a), -Infinity) : NaN);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    async stop() {
      running = false;
      await Promise.all([dbLoop, healthLoop]);
      return {
        pgConnectionsMax: max(db.map((s) => s.total)),
        pgActiveMax: max(db.map((s) => s.active)),
        advisoryWaitersMean: round(mean(db.map((s) => s.advisory)), 2),
        advisoryWaitersMax: max(db.map((s) => s.advisory)),
        notifyLockWaitersMax: max(db.map((s) => s.notify)),
        notifyQueueUsageMax: max(db.map((s) => s.queue)),
        eventLoopLagP99MaxMs: max(health.map((s) => s.p99)),
        eventLoopLagMaxMs: max(health.map((s) => s.max)),
        eventLoopUtilizationMax: max(health.map((s) => s.utilization)),
        healthSamples: health.length,
      };
    },
  };
}

// The load generator's own main-thread lag.
let mainLagMaxMs = 0;
let expectedTick = now() + 50;
setInterval(() => {
  const t = now();
  mainLagMaxMs = Math.max(mainLagMaxMs, t - expectedTick);
  expectedTick = t + 50;
}, 50).unref();

// ---------------------------------------------------------------------------------------------
// Tab A → tab B canary

function startCanary(jobId, bodies, count) {
  const controller = new AbortController();
  const sent = new Map();
  const toEvent = [];
  const toSnapshot = [];
  const errors = [];
  let opened = 0;
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));
  for (const tab of ["A", "B"]) {
    void readEvents(BASE, jobId, controller.signal, {
      onOpen: () => ++opened === 2 && readyResolve(),
      onMessage(m, t) {
        const hash = m.payload?.inputHash;
        if (tab !== "B" || m.type !== "config.added" || typeof hash !== "string") return;
        const sentAt = sent.get(hash);
        if (sentAt === undefined) return;
        toEvent.push(t - sentAt);
        // What the browser does next: re-read the job's snapshot.
        fetch(`${BASE}/api/v1/jobs/${jobId}`)
          .then((r) => r.arrayBuffer())
          .then(() => toSnapshot.push(now() - sentAt))
          .catch((e) => errors.push(`snapshot: ${e.message}`));
      },
      onError: (reason) => {
        errors.push(`tab ${tab}: ${reason}`);
        readyResolve();
      },
    });
  }
  let stopped = false;
  let i = 0;
  const saves = [];
  const loop = (async () => {
    await ready;
    while (!stopped && (count === null || i < count)) {
      const body = bodies[i++ % bodies.length];
      sent.set(body.inputHash, now());
      saves.push(save(jobId, body));
      await sleep(CANARY_INTERVAL_MS);
    }
  })();
  return {
    ready,
    done: loop,
    async stop() {
      stopped = true;
      await loop;
      const results = await Promise.all(saves);
      const deadline = now() + GRACE_MS;
      while (toSnapshot.length < results.filter((r) => r.created).length && now() < deadline) await sleep(100);
      controller.abort();
      for (const r of results) if (r.status >= 300 || r.status === 0) errors.push(`canary save ${r.status}`);
      return { toEvent: summarize(toEvent), toSnapshot: summarize(toSnapshot), saves: results.length, errors };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Stream workers

const workers = Array.from({ length: WORKERS }, () => new Worker(new URL("./streams.mjs", import.meta.url)));

function ask(worker, message, reply) {
  return new Promise((resolve) => {
    const handler = (data) => {
      if (data.kind !== reply) return;
      worker.off("message", handler);
      resolve(data);
    };
    worker.on("message", handler);
    worker.postMessage(message);
  });
}

async function collectAll() {
  const parts = await Promise.all(workers.map((w) => ask(w, { kind: "collect" }, "arrivals")));
  return { arrivals: parts.flatMap((p) => p.arrivals), errors: parts.flatMap((p) => p.errors), lagMaxMs: Math.max(...parts.map((p) => p.lagMaxMs)) };
}

// ---------------------------------------------------------------------------------------------
// One stage

async function stage(sql, streams, rate, bodies) {
  const jobCount = Math.min(JOBS, streams);
  const jobs = await Promise.all(Array.from({ length: jobCount }, (_, i) => createJob(i)));
  const canaryJob = await createJob(0);
  const streamJobs = Array.from({ length: streams }, (_, k) => jobs[k % jobCount]);
  const perJob = new Map();
  for (const j of streamJobs) perJob.set(j, (perJob.get(j) ?? 0) + 1);

  // Open the streams, a contiguous slice per worker, and wait until each is subscribed.
  const chunk = Math.ceil(streams / workers.length);
  const batch = Math.max(1, Math.floor(OPEN_CONCURRENCY / workers.length));
  const opened = await Promise.all(
    workers.map((w, i) => {
      const slice = streamJobs.slice(i * chunk, (i + 1) * chunk);
      return slice.length ? ask(w, { kind: "open", baseUrl: BASE, jobs: slice, offset: i * chunk, batch }, "opened") : { ok: 0, failed: 0 };
    }),
  );
  const openFailures = opened.reduce((n, o) => n + o.failed, 0);
  // Drop the replayed job.created events and reset the workers' lag; keep why streams failed.
  const openErrors = (await collectAll()).errors;
  mainLagMaxMs = 0;

  const samplers = startSamplers(sql);
  const canary = startCanary(canaryJob, bodies, null);
  await canary.ready;

  // Open-loop saves: save i goes at start + i/rate, to job i mod J, with a body unused on that job.
  const total = Math.round(rate * DURATION_S);
  const start = now();
  const pending = [];
  for (let i = 0; i < total; i++) {
    const wait = start + (i * 1000) / rate - now();
    if (wait > 1) await sleep(wait);
    pending.push(save(jobs[i % jobCount], bodies[Math.floor(i / jobCount)]));
  }
  const results = await Promise.all(pending);
  const lastSent = Math.max(...results.map((r) => r.sentAt));
  const canaryResult = await canary.stop();

  // Wait for the deliveries still in flight.
  const created = results.filter((r) => r.created);
  const sentAt = new Map(created.map((r) => [`${r.jobId}|${r.inputHash}`, r.sentAt]));
  const expected = created.reduce((n, r) => n + (perJob.get(r.jobId) ?? 0), 0);
  const arrivals = [];
  const errors = [];
  let clientLag = 0;
  const deadline = now() + GRACE_MS;
  for (;;) {
    const got = await collectAll();
    // Not push(...got.arrivals): a stage can deliver more than the call stack holds as arguments.
    for (const a of got.arrivals) arrivals.push(a);
    for (const e of got.errors) errors.push(e);
    clientLag = Math.max(clientLag, got.lagMaxMs);
    if (arrivals.length >= expected || now() > deadline) break;
    await sleep(500);
  }
  const db = await samplers.stop();
  await Promise.all(workers.map((w) => ask(w, { kind: "close" }, "closed")));

  const latencies = [];
  let lastArrival = start;
  for (const [, jobId, hash, t] of arrivals) {
    const s = sentAt.get(`${jobId}|${hash}`);
    if (s === undefined) continue;
    latencies.push(t - s);
    lastArrival = Math.max(lastArrival, t);
  }
  const saveErrors = results.filter((r) => r.status === 0 || r.status >= 300);
  const unique = (xs) => [...new Set(xs.map((e) => e.replace(/^stream \d+: /, "")))].join(", ");
  const errorSamples = [
    ...(saveErrors.length ? [`${saveErrors.length} saves failed (${unique(saveErrors.map((r) => `HTTP ${r.status}${r.error ? ` ${r.error}` : ""}`))})`] : []),
    ...(errors.length ? [`${errors.length} stream errors (${unique(errors)})`] : []),
    ...(canaryResult.errors.length ? [`canary: ${unique(canaryResult.errors)}`] : []),
    ...(openFailures ? [`${openFailures} streams failed to open (${unique(openErrors)})`] : []),
  ];
  return {
    streams,
    jobs: jobCount,
    targetSavesPerSec: rate,
    saves: results.length,
    savesPerSec: round(results.length / ((lastSent - start) / 1000 + 1 / rate), 1),
    saveErrors: saveErrors.length,
    saveMs: summarize(results.map((r) => r.ms)),
    expectedDeliveries: expected,
    deliveries: latencies.length,
    missing: Math.max(0, expected - latencies.length),
    streamErrors: errors.length + openFailures,
    eventsDeliveredPerSec: round(latencies.length / ((lastArrival - start) / 1000), 0),
    latencyMs: summarize(latencies),
    canary: canaryResult,
    clientLagMaxMs: round(Math.max(clientLag, mainLagMaxMs), 0),
    errorSamples,
    ...db,
  };
}

// ---------------------------------------------------------------------------------------------
// Report

const f = (x) => (Number.isFinite(x) ? String(round(x, x < 10 ? 1 : 0)) : "–");
const errorCount = (r) => r.saveErrors + r.streamErrors + r.missing + r.canary.errors.length;

function row(r) {
  return [
    r.streams,
    r.jobs,
    r.targetSavesPerSec,
    r.savesPerSec,
    r.eventsDeliveredPerSec,
    `${f(r.latencyMs.p50)} / ${f(r.latencyMs.p95)} / ${f(r.latencyMs.p99)}`,
    f(r.saveMs.p95),
    `${f(r.canary.toEvent.p95)} / ${f(r.canary.toSnapshot.p95)}`,
    r.pgConnectionsMax,
    `${f(r.advisoryWaitersMean)} / ${r.advisoryWaitersMax}`,
    r.notifyQueueUsageMax,
    `${f(r.eventLoopLagP99MaxMs)} / ${f(r.eventLoopLagMaxMs)}`,
    f(r.eventLoopUtilizationMax),
    f(r.clientLagMaxMs),
    errorCount(r),
  ].join(" | ");
}

const HEADER =
  "| Streams | Jobs | Saves/s target | Saves/s sent | Events/s delivered | Save → other streams p50 / p95 / p99 ms | Save response p95 ms | Tab A→B event / snapshot p95 ms | PG conns max | Advisory waiters mean / max | NOTIFY queue max | Loop lag p99 / max ms | Loop util max | Client lag max ms | Errors |\n" +
  "|---:|---:|---:|---:|---:|---|---:|---|---:|---|---:|---|---:|---:|---:|";

async function main() {
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`${BASE}/api/v1/health isn't answering 200. Start Postgres and the app (next start) first.`);

  const perJob = Math.max(...RATES.map((r) => Math.ceil((r * DURATION_S) / Math.min(JOBS, Math.min(...STREAMS)))));
  const needed = Math.max(perJob, Math.ceil((DURATION_S * 1000) / CANARY_INTERVAL_MS) + 10, PAIR_SAVES);
  const t0 = now();
  const { databaseUrl, bodies } = loadBodies(needed);
  console.log(`load: ${bodies.length} save bodies from the engine in ${Math.round(now() - t0)} ms; target ${BASE}`);
  const sql = postgres(databaseUrl, { max: 1, connection: { application_name: "crate-load-sampler" }, onnotice: () => {} });

  try {
    // Idle tab A → tab B: nothing else running.
    const pair = startCanary(await createJob(0), bodies, PAIR_SAVES);
    await pair.done;
    const idle = await pair.stop();
    console.log(
      `load: idle tab A → tab B (${idle.saves} saves): event p50 ${f(idle.toEvent.p50)} p95 ${f(idle.toEvent.p95)} max ${f(idle.toEvent.max)} ms; ` +
        `snapshot re-read p50 ${f(idle.toSnapshot.p50)} p95 ${f(idle.toSnapshot.p95)} max ${f(idle.toSnapshot.max)} ms` +
        (idle.errors.length ? `; errors: ${idle.errors.join(", ")}` : ""),
    );

    const results = [];
    console.log(`\n${HEADER}`);
    outer: for (const streams of STREAMS) {
      for (const [ri, rate] of RATES.entries()) {
        const r = await stage(sql, streams, rate, bodies);
        results.push(r);
        console.log(`| ${row(r)} |`);
        if (r.errorSamples.length) console.log(`  errors: ${r.errorSamples.join("; ")}`);
        const failed = r.latencyMs.p95 > MAX_P95 || errorCount(r) > 0;
        if (failed && !args["keep-going"]) {
          if (ri === 0) break outer;
          break;
        }
        await sleep(2000); // Let the server settle between stages.
      }
    }

    if (args.out) {
      const machine = {
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        cores: cpus().length,
        memGb: Math.round(totalmem() / 2 ** 30),
        node: process.version,
      };
      await writeFile(args.out, JSON.stringify({ at: new Date().toISOString(), base: BASE, args, machine, idle, results }, null, 2));
      console.log(`\nload: results written to ${args.out}`);
    }
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
    await sql.end({ timeout: 1 });
  }
}

await main();
