# Load test: saves and live events

How far one Next.js process and one Postgres carry the shared-job flow of #46: a save posted to
`POST /api/v1/jobs/:id/configs` (recomputed by the engine, committed with its `config.added`
event, NOTIFYed) reaching every other tab that has the job's SSE stream
(`GET /api/v1/events?job=…`) open. Opt-in and manual: it is not in CI or the pre-commit hook.

The measured limits are summarised in [SPECIFICATION.md §9.1](SPECIFICATION.md#91-capacity-of-saves-and-live-events-46);
the event framework itself is in [POSTGRES.md "Events"](POSTGRES.md#events).

## Running it

```bash
bun run infra:up && bun run db:migrate      # Postgres (and the blob emulator)
bun run build && bun run start -- -p 3371   # one production Node process; not `next dev`
bun run load -- --base-url http://localhost:3371 --out load.json
bun run load:lock                           # the event-ordering lock on its own (below)
```

In a parallel worktree, set the compose project and ports first (POSTGRES.md "Parallel
worktrees and e2e"); `bun run load` reads `DATABASE_URL` / `DB_PORT` / `DB_NAME` from the shell
or `.env.local` like every other script. A full default ramp takes about 15 minutes. Run nothing
else heavy on the machine meanwhile: the load generator shares the CPU with the server.

| Option | Default | Meaning |
|---|---|---|
| `--base-url` | `$LOAD_BASE_URL` or `http://localhost:3000` | The running app |
| `--streams` | `10,100,500,1000` | Open SSE streams per stage (the outer ramp) |
| `--rates` | `5,20,50,100` | Saves per second per stage (the inner ramp) |
| `--jobs` | `20` | Jobs per stage; the streams are spread evenly over them (fewer when there are fewer streams) |
| `--duration` | `15` | Seconds of saves per stage |
| `--workers` | `8` | Worker threads holding the streams |
| `--grace` | `10` | Seconds to wait for late deliveries after the last save |
| `--max-p95` | `1000` | A stage over this p95 (ms) ends its rate ramp |
| `--keep-going` | off | Don't stop the ramp at the first failing stage |
| `--pair-saves` | `40` | Saves in the idle tab A → tab B measurement before the ramp |
| `--out` | none | Write every stage's full numbers (and the machine) as JSON |

The rate ramp for a stream count stops at the first stage whose p95 is over `--max-p95` or that
has any error (a failed save, a stream that didn't open or broke, a missing delivery); the whole
ramp stops when the lowest rate already fails.

**One org, many jobs.** Multi-tenancy is rescoped to one org (#60), and every process receives
every notification on one channel, so tenants would add nothing a job doesn't. The load is varied
by jobs instead: how many streams share a job decides how many deliveries one save causes.

### What a stage does

1. Opens `--jobs` fresh jobs (`POST /jobs`, `reuse: false`) and spreads the streams over them,
   opened about 96 at a time and each counted once its first bytes arrive (it is then subscribed).
2. Posts saves **open loop** at the target rate (save *i* at *start + i/rate*, whether or not
   earlier ones have answered), round-robin over the jobs. Each save is a real configuration from
   the engine with its own `inputHash`, so the server's recompute check passes and each save adds
   one link and one `config.added`.
3. Times every `config.added` on every stream from the moment its save was **sent**. Nobody
   streams their own save, so every delivery is to an "other tab". The latency covers the HTTP
   request, the engine recompute (~15 ms), the transaction and its NOTIFY, the listener, the hub,
   each stream's own read of the `event` table, and SSE.
4. Meanwhile it samples Postgres every 250 ms (`pg_stat_activity`: connections, active backends,
   backends waiting on the advisory lock and on the NOTIFY commit lock;
   `pg_notification_queue_usage()`) and `GET /api/v1/health` every second (the server's
   event-loop lag and utilisation, below).
5. Runs a **tab A → tab B canary** on its own job: two streams, a save every 500 ms, timed to the
   event on B and to B's snapshot re-read (`GET /jobs/:id`), which is what the browser does on an
   event (`src/state/jobSync.ts`).

Before the ramp, the same canary runs alone (`--pair-saves` saves) for the idle tab A → tab B time.

### The columns

| Column | |
|---|---|
| Saves/s sent | Saves actually sent per second (open loop, so it matches the target unless the generator lags) |
| Events/s delivered | `config.added` messages received across all streams per second (saves × streams per job) |
| Save → other streams | p50 / p95 / p99 from sending a save to its event arriving on another stream |
| Save response | Time for the save request itself |
| Tab A → B | The canary: event on tab B / tab B's snapshot re-read done |
| PG conns | Connections to the app database in `pg_stat_activity` (pool + listener + the sampler's 1) |
| Advisory waiters | Backends waiting on `EVENT_ORDER_LOCK`, mean / max over the samples |
| NOTIFY queue | `pg_notification_queue_usage()`, max |
| Loop lag | The server's event-loop delay, p99 / max over the 1 s windows (from `/api/v1/health`) |
| Loop util | Event-loop utilisation (busy share), max window |
| Client lag | The load generator's own worst event-loop lag; if it is large, latencies include client delay |

### Server-side metric: event-loop lag in `/api/v1/health`

`GET /api/v1/health` has an `eventLoop` field (`src/server/eventLoop.ts`): over the last 1 s
window, the event-loop delay in ms (`mean`, `p50`, `p99`, `max`, from
`perf_hooks.monitorEventLoopDelay` at 20 ms resolution, with the resolution subtracted so an idle
loop reads ~0) and the loop's utilisation (0–1, `performance.eventLoopUtilization`). It starts on
the first health request and costs one native histogram and a 1 s unref'd timer.

```json
"eventLoop": { "windowMs": 1000, "delayMs": { "mean": 0.84, "p50": 0.48, "p99": 7.71, "max": 7.71 }, "utilization": 0.288 }
```

### Why a Node script, not k6 (or Bun)

- **k6** has no SSE client in its stock image (it needs the `xk6-sse` extension and a custom
  build), and its JavaScript runtime can't run the engine, so valid save bodies would have to be
  generated elsewhere anyway. Timestamps from a custom SSE extension are also harder to trust
  than a reader we can see.
- **Bun** was the first choice (the repo's script runner), but Bun 1.3.5's `fetch` failed 0.4–13 %
  of 1000 concurrent streaming requests ("socket connection was closed unexpectedly", "Unable to
  connect"), even opened 100 at a time, where Node 24's `fetch` (undici) opened 1000 and 2000
  with none failing against the same server. Those failures would read as server errors.
- So the generator is `scripts/load/run.mjs` on **Node**: `fetch` and a 40-line SSE reader
  (`sse.mjs`) that timestamps each chunk as it is read, the streams in `worker_threads`
  (`streams.mjs`) so parsing doesn't delay the save scheduler, and `postgres` for the samplers.
  The save bodies come from the engine through `bun scripts/load/bodies.ts` (TypeScript with
  path aliases, which Bun runs as is).
- Streams are opened at most ~96 at a time: a burst of 1000 connects overflows macOS's default
  accept backlog (`kern.ipc.somaxconn` = 128) and gets connection resets from the OS, not the app.

## Machine and setup

All numbers below are from one run on a developer laptop, with the load generator on the same
machine. Treat them as an order of magnitude for one process, not a production SLO.

| | |
|---|---|
| Machine | Apple M1 Max (10 cores), 64 GB, macOS (Darwin 27.2) |
| Docker | Docker Desktop 29.9.3, VM with 10 CPUs and 7.6 GiB |
| Postgres | `postgres:18.6-alpine3.24` from `docker-compose.yml`, stock settings (`max_connections` 100, `shared_buffers` 128 MB, `synchronous_commit` on) |
| App | `next build` + `next start` (Next.js 16.4.6, Node 24.21.0), **one process**, `DB_POOL_MAX` 10 (the default) unless noted |
| Load | `bun run load` defaults: 20 jobs per stage, 15 s per stage, 8 worker threads |

## Results

### Tab A → tab B, idle

40 saves, one every 500 ms, nothing else running: event on tab B **p50 31 ms, p95 67 ms, max
118 ms**; tab B's snapshot re-read done p50 46 ms, p95 129 ms. Target < 1 s: met with a wide
margin. (Other idle runs: event p95 26–53 ms.)

### The ramp (`DB_POOL_MAX` = 10, the default)

| Streams | Jobs | Saves/s | Events/s delivered | Save → other streams p50 / p95 / p99 ms | Save response p95 ms | Tab A→B event / snapshot p95 ms | PG conns | Advisory waiters mean / max | NOTIFY queue | Loop lag p99 ms | Loop util | Errors |
|---:|---:|---:|---:|---|---:|---|---:|---|---:|---:|---:|---:|
| 10 | 10 | 5 | 5 | 27 / 42 / 69 | 40 | 42 / 54 | 11 | 0 / 0 | 0 | 6.8 | 0.3 | 0 |
| 10 | 10 | 20 | 20 | 30 / 45 / 59 | 44 | 44 / 61 | 11 | 0 / 1 | 0 | 8.2 | 0.4 | 0 |
| 10 | 10 | 50 | 50 | 33 / 46 / 57 | 45 | 48 / 68 | 12 | 0 / 1 | 0 | 4.4 | 0.6 | 0 |
| 10 | 10 | 100 | 90 | 90 / **4233** / 4807 | 2895 | 4401 / 7111 | 11 | 2.5 / 5 | 0 | 114 | 1.0 | 0 |
| 100 | 20 | 5 | 25 | 28 / 41 / 51 | 38 | 42 / 55 | 11 | 0 / 1 | 0 | 8.8 | 0.2 | 0 |
| 100 | 20 | 20 | 100 | 32 / 59 / 85 | 54 | 54 / 88 | 11 | 0 / 1 | 0 | 11 | 0.4 | 0 |
| 100 | 20 | 50 | 250 | 48 / 89 / 113 | 82 | 88 / 128 | 11 | 0.1 / 1 | 0 | 21 | 0.6 | 0 |
| 100 | 20 | 100 | 435 | 55 / **2620** / 3208 | 1850 | 2578 / 5255 | 11 | 1.8 / 6 | 0 | 17 | 0.8 | 0 |
| 500 | 20 | 5 | 126 | 50 / 119 / 174 | 105 | 118 / 154 | 11 | 0 / 0 | 0 | 25 | 0.9 | 0 |
| 500 | 20 | 20 | 499 | 44 / 118 / 175 | 102 | 108 / 212 | 11 | 0 / 1 | 0 | 103 | 1.0 | 0 |
| 500 | 20 | 50 | 1238 | 512 / 745 / 1076 | 502 | 776 / 1865 | 11 | 0.1 / 2 | 0 | 105 | 0.9 | 0 |
| 500 | 20 | 100 | 1813 | 7289 / **11127** / 12018 | 7186 | 11337 / 16639 | 11 | 3 / 6 | 0 | 133 | 1.0 | 0 |
| 1000 | 20 | 5 | 253 | 37 / 316 / 425 | 255 | 414 / 441 | 11 | 0 / 1 | 0 | 86 | 0.9 | 0 |
| 1000 | 20 | 20 | 999 | 44 / 340 / 437 | 216 | 297 / 711 | 11 | 0 / 0 | 0 | 152 | 1.0 | 0 |
| 1000 | 20 | 50 | 1988 | 3926 / **6361** / 6846 | 3803 | 6225 / 13144 | 12 | 1 / 5 | 0 | 143 | 1.0 | 0 |

PG conns includes the sampler's own connection, so the app held 10 pool connections plus 1
listener throughout. "Loop util" is the busiest 1 s window, which can include the tail of opening
the streams; the save-bound stages are the ones to read it from.

Supplementary stages (same server and pool, one stage each):

| Streams | Jobs | Saves/s | Events/s delivered | p50 / p95 / p99 ms | Save response p95 ms | Advisory waiters mean / max | Errors |
|---:|---:|---:|---:|---|---:|---|---:|
| 10 | 10 | 60 | 60 | 47 / 389 / 535 | 322 | 0.5 / 4 | 0 |
| 10 | 10 | 70 | 69 | 437 / **2009** / 2323 | 1398 | 3.1 / 5 | 0 |
| 10 | 10 | 80 | 80 | 105 / **1707** / 2004 | 1156 | 2 / 6 | 0 |
| 1000 | **5** | 20 | 3526 | 712 / **2264** / 2560 | 1458 | 0 / 1 | 0 |
| 1000 | **100** | 20 | 200 | 30 / 66 / 112 | 63 | 0 / 0 | 0 |
| 2000 | 20 | 5 | 505 | 42 / 64 / 89 | 36 | 0 / 0 | 0 |
| 2000 | 20 | 10 | 1002 | 52 / 87 / 115 | 57 | 0 / 0 | 0 |
| 4000 | 20 | 2 | 411 | 69 / 133 / 172 | 58 | 0 / 0 | 0 |

### A bigger pool (`DB_POOL_MAX` = 30)

| Streams | Jobs | Saves/s | Events/s delivered | p50 / p95 / p99 ms | Save response p95 ms | PG conns | Advisory waiters mean / max | Loop util | Errors |
|---:|---:|---:|---:|---|---:|---:|---|---:|---:|
| 10 | 10 | 60 | 60 | 37 / 180 / 365 | 178 | 25 | 0.6 / 16 | 0.8 | 0 |
| 10 | 10 | 80 | 80 | 41 / 324 / 602 | 313 | 31 | 1.2 / 25 | 0.8 | 0 |
| 10 | 10 | 100 | 98 | 57 / 528 / 605 | 447 | 31 | 6 / 26 | 0.9 | 0 |
| 500 | 20 | 50 | 1246 | 50 / 157 / 368 | 152 | 31 | 0.4 / 11 | 1.0 | 0 |
| 1000 | 20 | 50 | 2475 | 209 / 328 / 369 | 228 | 31 | 0.5 / 4 | 1.0 | 0 |
| 1000 | 20 | 100 | 4391 | 2012 / **2874** / 3035 | 1749 | 31 | **17 / 23** | 0.9 | 0 |
| 2000 | 20 | 50 | 4660 | 1060 / **1435** / 1511 | 847 | 31 | 0.2 / 3 | 1.0 | 0 |

### The event-ordering lock on its own (`bun run load:lock`)

`events.append` takes `pg_advisory_xact_lock(EVENT_ORDER_LOCK)` and holds it to commit, so event
ids commit in order (POSTGRES.md "Writing"). `scripts/load/lock.ts` runs the event-writing
transaction straight against Postgres, N connections in a loop for 5 s each, with four tails:
`none` (insert only), `lock` (lock, then insert), `app` (what `events.append` does: savepoint,
lock, insert, release) and `single` (lock and insert in one statement). `pg_sleep` stands in for
the save's own statements before the event. Event commits per second (p50 / p95 ms):

| Work before ms | Conns | none | lock | app (today) | single |
|---:|---:|---|---|---|---|
| 0 | 1 | 398 (2.1 / 5.0) | 220 (3.8 / 9.7) | 154 (5.7 / 11.8) | 232 (3.7 / 8.3) |
| 0 | 4 | 729 (4.2 / 12.6) | 285 (13 / 23) | 284 (13 / 23) | 303 (12 / 26) |
| 0 | 8 | 441 (16 / 34) | 230 (30 / 62) | 273 (27 / 43) | 201 (35 / 84) |
| 0 | 16 | 667 (20 / 54) | 241 (61 / 108) | 219 (66 / 139) | 381 (39 / 64) |
| 0 | 32 | 931 (27 / 84) | 291 (111 / 148) | 290 (111 / 151) | 450 (69 / 104) |
| 5 | 4 | 309 (12 / 21) | 251 (15 / 27) | 270 (14 / 25) | 288 (12 / 24) |
| 5 | 8 | 617 (12 / 20) | 260 (29 / 49) | 264 (29 / 49) | 373 (17 / 45) |
| 5 | 16 | 604 (19 / 56) | 328 (50 / 72) | 282 (57 / 85) | 377 (40 / 67) |
| 5 | 32 | 1046 (29 / 49) | 266 (120 / 175) | 185 (152 / 269) | 265 (118 / 212) |

Docker Desktop's disk makes these noisy (±30 % between runs), but the shape repeats: without the
lock, event commits scale with connections (Postgres serialises only the NOTIFY step of commit);
with it they flatten at **~220–330 commits/s**, whatever the concurrency, because the lock is
held across several client round trips (lock → insert → release → COMMIT) rather than just the
commit.

## What limits it

1. **The Node event loop, then the pool.** Every limit above came with the loop near 100 % busy
   and no errors. Two kinds of work fill it:
   - *Saves*: the engine recompute (~15 ms of CPU each, `verify.ts`) runs on the request thread,
     **inside** the transaction, so each save holds a pool connection while it computes. With
     the default pool of 10 the process tops out at **~60 saves/s** (p95 389 ms at 60, 2 s at 70);
     with a pool of 30, **~100 saves/s** (p95 528 ms).
   - *Deliveries*: a notification makes **every stream of that job** run its own
     `events.listForStream` query, through the same pool, then serialise and write the row. One
     save to a job with 50 open streams is 50 queries. With pool 10 the process delivers
     **~1000–1200 events/s** under 1 s p95; with pool 30, **~2500/s**.
2. **Open streams are cheap; deliveries are not.** 4000 open streams at 2 saves/s (411
   deliveries/s) had p95 133 ms; 1000 streams at 20 saves/s was 66 ms p95 spread over 100 jobs
   (200 deliveries/s) and 2.3 s spread over 5 jobs (3526 deliveries/s). Capacity is set by
   *saves × streams per job*, not by the number of connections. Postgres connections stay at the
   pool plus one listener however many streams there are.
3. **Postgres was never the bottleneck here.** `pg_notification_queue_usage()` stayed at 0 (max
   9.5 × 10⁻⁷), no backend ever waited on the NOTIFY commit lock in the sampled moments, and **no
   event was lost**: every stage, including the saturated ones, delivered every expected event to
   every stream (e.g. 75 000 of 75 000).
4. **The event-ordering lock is ~4× above today's save ceiling, but it amplifies overload.** At
   the measured limits the app wrote 60–100 events/s against a lock ceiling of ~220–330/s, and
   waiters averaged ≤ 0.6. Once the process is saturated, though, waiters climb (mean 2.5–3 with
   pool 10, **17** with pool 30 at 1000 streams × 100 saves/s): the lock is held from `append`
   until the COMMIT, and the COMMIT waits for the busy Node loop to send it, so loop lag becomes
   lock hold time and every other save queues behind it. Collapsing lock and insert into one
   statement (`single`) raised the ceiling ~1.3–1.6× at 16–32 connections in the microbenchmark.
5. **The listener's liveness probe misfires under overload.** In one saturated stage (pool 10,
   500 streams × 100 saves/s) the bus logged `listener lost (probe timed out); reconnecting`: the
   probe NOTIFY goes through the same exhausted pool and didn't make its 5 s deadline, so a
   healthy listener was torn down and every stream told to resync (one more read each) at the
   worst moment. Nothing was lost, but it adds load when there is least room.

### Improvements in order of payoff (not done here)

1. Move the save recompute off the event loop (`worker_threads`, as #46 "Server CPU spikes"
   already says) and out of the transaction (verify first, then open the transaction).
2. Coalesce fan-out reads per job: on a notification, read the job's new rows once and hand them
   to every stream of that job, instead of one `listForStream` per stream. That turns deliveries
   from O(streams) queries into O(jobs).
3. Size `DB_POOL_MAX` for the load (30 roughly doubled both ceilings here; Postgres had room).
4. Take the ordering lock in the same statement as the insert (or in the `event` trigger), and
   make the probe tolerate a slow pool (count consecutive misses, or time out relative to the
   loop's lag).
5. Then scale out: more Next.js instances behind the proxy. Each adds one LISTEN connection and
   its own fan-out capacity; the event write path is shared.

## When to move to a dedicated broker

The `EventBus` interface (`src/server/events/bus.ts`) is the swap point: producers keep writing
the `event` table and SSE streams keep reading it, and only "something committed" moves from
LISTEN/NOTIFY to Redis Streams, NATS or Kafka. A broker does **not** fix the limits measured
above (CPU, pool, per-stream reads): those are solved per process and by adding processes. Swap
the bus when one of these holds, sustained, after improvements 1–4:

| Signal | Threshold | Why |
|---|---|---|
| Event-writing transactions, all instances together | **> ~200/s** (about two-thirds of the measured 220–330/s lock ceiling) | Ordering and NOTIFY commits are serialised database-wide; a broker with per-partition ordering (or ids assigned after commit) removes that |
| `EVENT_ORDER_LOCK` waiters | mean **> 1** in `pg_stat_activity` while the app is not CPU-bound | Writes are queueing on ordering, not on the app |
| `pg_notification_queue_usage()` | **> 0.01** (1 %) for minutes, or any 50 % alert | A listener isn't keeping up; at 100 % every event write fails |
| App instances | **> ~20**, or across regions | Every instance receives and filters every org's notifications on one channel, and LISTEN needs a direct session per instance (no transaction-mode pooler) |
| Need per-tenant channels, replay beyond the `event` table, or payloads > 8 KB | when it arises | Beyond what NOTIFY offers |

At today's ceiling (≤ 100 saves/s per process) that is two to three app instances running flat
out before the first threshold, so LISTEN/NOTIFY is the right bus for the prototype.

## Files

| File | |
|---|---|
| `scripts/load/run.mjs` | The ramp, samplers, canary and report (`bun run load`) |
| `scripts/load/streams.mjs` | Worker thread holding a share of the SSE streams |
| `scripts/load/sse.mjs` | The SSE reader and clock |
| `scripts/load/bodies.ts` | Engine-made save bodies, run by Bun from `run.mjs` |
| `scripts/load/lock.ts` | The event-ordering lock microbenchmark (`bun run load:lock`) |
| `src/server/eventLoop.ts` | The event-loop sampler behind `/api/v1/health`'s `eventLoop` |
