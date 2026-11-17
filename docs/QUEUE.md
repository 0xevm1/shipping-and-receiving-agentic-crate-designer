# Background jobs, the headless API and the CLI

Server-side engine work for #46 (suggested slice 7): a Postgres job queue (no Redis), a
`worker_threads` pool that keeps engine work off the request thread, the stateless
`POST /api/v1/designs` endpoint, API keys for clients other than the UI, and the
`bun run crate` command line. The data store itself is in [POSTGRES.md](POSTGRES.md); the engine
in [SPECIFICATION.md §5.1](SPECIFICATION.md); the sweep it runs in §7.16.

```
 POST /jobs ──enqueueSweep──▶ queue_job ──NOTIFY crate_jobs──▶ bun run worker (1..n processes)
                                  ▲                              │ claim: FOR UPDATE SKIP LOCKED
                                  └──── poll every 5 s ──────────┤ run the handler under the job's org
                                                                 ▼
                                               engine worker_threads pool ─▶ runSweep / rankConfigurations
                                                                 │
                     configurations + design_job + event (configs.ready) in one transaction
```

## Worker threads

All server-side engine work (a sweep, a design, a bundle) runs in a `worker_threads` pool
(`src/server/workers/`), never on the thread that serves requests and holds SSE streams. A full
sweep is 30–400 ms of CPU; on the main thread it would stall every stream on the instance.

- **One bundle for every runtime.** The threads run `.engine-worker/engine-thread.mjs`, a single
  plain-JS file `bun run engine:build` makes from `src/server/workers/engineThread.ts` (the engine
  and its dependencies, ~3.4 MB, ~50 ms to build). Next.js (Node), `bun run worker`, the CLI and
  vitest can all start it with `new Worker(path)`; none of them can start a TypeScript file with
  `@/` imports in a thread by itself. `dev`, `build`, `worker` and the integration tests build it
  first; it is git-ignored. If it is missing, `/designs` answers 503 and the log says to run
  `bun run engine:build`.
- **Pool** (`pool.ts`): up to `ENGINE_POOL_SIZE` threads (default CPU count − 1, 1 to 4),
  started on demand, FIFO queue in front. A thread that crashes fails only its own task and is
  replaced; a task over 120 s fails and its thread is terminated; idle threads don't keep a
  process alive.
- **Proof:** `src/server/workers/pool.integration.test.ts` runs three full sweeps (PART-001 to
  003, 1–200 per crate, with a total) on the pool while sampling the main thread's event-loop
  delay: the worst lag must stay under **50 ms**, and the pool's
  answer must equal the in-thread engine's exactly.

| Env | Default | |
|---|---|---|
| `ENGINE_POOL_SIZE` | CPU count − 1 (1–4) | Threads per process |
| `ENGINE_WORKER_PATH` | `./.engine-worker/engine-thread.mjs` | Where the thread bundle is |

## The queue

One table, `queue_job` (`src/server/db/schema.ts`, migration `0004_queue_api_keys.sql`). Queries
in `src/server/db/queue.ts`, the loop in `src/server/queue/runner.ts`.

| Column | |
|---|---|
| `org_id` | The org it was enqueued for; the handler runs under `orgContext(org_id)` |
| `kind`, `payload` | What to run (`sweep`, `bundle`) and its JSON input |
| `status` | `queued` → `running` → `done`, or back to `queued` (retry), or `dead` (dead letter) |
| `attempts`, `max_attempts` | Claims so far / allowed (default 5) |
| `run_at` | Not claimed before this; pushed back after a failure |
| `locked_by`, `locked_until` | The running claim's worker and lease |
| `dedupe_key` | At most one queued-or-running job per `(org, kind, key)` (partial unique index) |
| `last_error`, `result`, `finished_at` | Outcome |

- **Enqueue** (`createQueueStore(executor).enqueue(ctx, …)`) inserts the row and runs
  `pg_notify('crate_jobs', id)` in the same transaction: pass a transaction to commit the job with
  the change that caused it.
- **Claim:** `UPDATE queue_job SET status='running', attempts=attempts+1, locked_by=…, locked_until=now()+lease
  WHERE id = (SELECT id … WHERE (status='queued' AND run_at<=now()) OR (status='running' AND locked_until<now())
  ORDER BY run_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`. Any number of workers
  claim at once without waiting on each other or taking the same row.
- **Wake-up:** each worker LISTENs on `crate_jobs` on its own session connection
  (`src/server/queue/listen.ts`) and claims at once when notified. It also polls every
  `QUEUE_POLL_MS` (5 s), so a dropped notification or a dead listener only costs latency.
- **Leases (visibility timeout):** a claim leases the job for `QUEUE_LEASE_MS` (60 s), renewed every
  third of that while the handler runs. A worker that crashes stops renewing; once the lease runs
  out another worker claims the job again (the attempt counts). `complete` and `fail` only apply
  for the worker holding the lease, so a worker that comes back late can't overwrite the outcome;
  its handler's `signal` is aborted when it loses the lease.
- **Retries:** a thrown error puts the job back to `queued` with `run_at = now() + min(5 min, 1 s ·
  2^(attempt−1))`. A `PermanentJobError` (bad payload, missing row, unknown kind) or the last
  attempt sends it to **`dead`**, the dead letter: it stays in the table with `last_error` for a
  person to read, and `onDead` runs once (the sweep job emits `job.error` there). A job whose
  lease ran out `max_attempts` times is dead-lettered on its next claim rather than run again.
- **Org scoping:** enqueue and `get` take an `OrgContext`. Claiming does not (a worker serves
  every org) and reads only `queue_job`; the handler gets `orgContext(job.org_id)` and every query
  it makes is org-scoped as usual.
- **Fair scheduling between orgs is deferred** (#60): a single FIFO by `run_at`. `org_id` on every
  row is what a later round-robin (`ORDER BY` last-served org) would need.

`bun run worker` (`scripts/worker.ts`) is the worker process: `QUEUE_CONCURRENCY` jobs at once
(default 2), an engine pool of its own, clean stop on SIGINT / SIGTERM (claims nothing new, lets
running jobs finish). Run one next to `bun run dev`, or several on several machines.

| Env | Default | |
|---|---|---|
| `QUEUE_CONCURRENCY` | `2` | Jobs one worker process runs at once |
| `QUEUE_POLL_MS` | `5000` | Polling fallback interval |
| `QUEUE_LEASE_MS` | `60000` | Lease (visibility timeout) |

### Job kinds

`src/server/queue/jobs.ts`; Route Handlers import `enqueueSweep` / `enqueueBundle` from
`@/server/queue` (server-only).

| Kind | Payload | Does |
|---|---|---|
| `sweep` | `{ jobId }` | For a `design_job`: `rankConfigurations` on the pool (the part's size and mass, the app's default rules and standards, the job's `total_quantity`). Then, in one transaction: each shortlisted configuration saved (`origin = precomputed`, content-addressed by `inputHash`), the job set to `ready` with the recommendation as `selected_configuration_id`, and `configs.ready` emitted (`{ count, recommendedConfigurationId, inputHash }`). The queue row's `result` holds the curve (200 points) and the total plan. Dead-lettered: the job goes to `error` and `job.error` is emitted with a generic message |
| `bundle` | `{ jobId, configurationIds }` | Server-built `bundle.zip`. **Stub:** the payload, `enqueueBundle` and the pool's `bundle` task (`buildBundleZip` from GLB bytes) exist; the artifacts slice passes its handler as `createJobHandlers({ …, bundle })`. Until then a bundle job dead-letters with "Server-built bundles aren't available yet." |

**Every new design job queues its sweep by itself:** `src/server/queue/register.ts` registers an
`onJobCreated` hook (`src/server/jobs/hooks.ts`, imported by `src/server/jobs/index.ts`), which
runs inside the transaction `POST /api/v1/jobs` opens, so the queue row commits or rolls back with
the job. To queue work in your own transaction, pass the repository `inTransaction` hands you
(`repo.queue` is the queue store on that transaction):

```ts
import { enqueueBundle } from "@/server/queue";
await inTransaction(getDb(), (tx) => enqueueBundle(ctx, { jobId, configurationIds }, tx));
```

`enqueueSweep` is deduplicated per design job (a second call while one is queued or running
returns the same queue job). The sweep job saves each configuration (`configurations.save`, content
addressed) and links it to the job as `precomputed` (`configurations.link`); it moves the job to
`ready` only from `open` / `running`, and selects the recommendation only when nothing is selected
yet. Both bump the job's `version`, so a client holding the old version gets `409` on its next
`PATCH` and re-reads (docs/API.md).

## POST /api/v1/designs

A stateless, headless calculation for scripts: a GLB and the part's facts in, ranked
configurations out. **Nothing is saved.** The engine work runs on the worker pool. Shapes:
`src/lib/api/designs.ts` (`DesignsFieldsSchema`, `DesignsApiResponseSchema`).

`multipart/form-data`:

| Field | |
|---|---|
| `file` | The part's binary `.glb`; the same checks and messages as `POST /api/v1/parts` (text glTF 415, Draco / Meshopt or damaged 422, over 50 MB 413) |
| `mass` | kg per part, required |
| `material`, `density`, `name` | Optional, as for `/parts` |
| `total` | Optional: total parts to ship (1–10 000). Adds `total`, the even split |
| `freightRates` | Optional JSON, `{"usdPerCwtByClass": {"70": 41.5}, "minimumUsd": 95}`. Without it no freight dollars appear |

```bash
curl -s http://localhost:3000/api/v1/designs \
  -H "Authorization: Bearer $CRATE_API_KEY" \
  -F file=@public/parts/PART-001-machined-steel-bracket.glb -F mass=21.5 -F total=40
```

The answer: `engineVersion`, `inputHash` (of the sweep's inputs), `part`, `basis`
(`crate-only` without rates), `recommendation` (`quantityPerCrate`, `rationale`, `stoppedBy`),
`configurations` (the shortlist, best first; each with its own design `inputHash`, `settings`,
cost per part, crate and freight cost, gross, outside size, screws and `crates`), `total`,
`curve` (every quantity 1–200: `ok`, the binding rule, the score) and `problem`, plus `model`
(sha256, size, `readAsMm`). Errors use the `/parts` shape: `{ error: { code, message, field? } }`.

## API keys

Clients other than the UI (the CLI, an ERP, batch scripts) send `Authorization: Bearer <key>`.

- **Keys** are `cdk_` + 32 random bytes (base64url). Only the SHA-256 is stored (`api_key.key_hash`;
  256-bit random keys need no slow hash), with `org_id`, `name`, a `prefix` to recognise it,
  `created_at`, `last_used_at` (touched at most once a minute) and `revoked_at`.
- **Scripts:** `bun run apikey:create -- --name erp-sync` prints the key once; `bun run apikey:list`;
  `bun run apikey:revoke -- --id <uuid>`. `--org <uuid>` for another org (default: the prototype's
  one org).
- **`authenticate(request, { keys, requireKeyOutsideUi })`** (`src/server/auth.ts`) is
  the one helper a Route Handler calls for its `OrgContext`:
  1. `Authorization` present: it must be `Bearer <live key>`, else **401** (even from the UI). The
     key's org is the context.
  2. Else `Sec-Fetch-Site: same-origin` (set by browsers on the app's own `fetch` calls, and not
     settable by page scripts): the UI, as `DEFAULT_ORG` until there are sessions.
  3. Else: **401** where the route requires a key (`/designs` does), otherwise `DEFAULT_ORG`.
- **The same-origin marker is routing, not security:** a non-browser client can send any
  header. It keeps scripts on keys from the start; UI sessions (open question in #46) replace it.
  `/parts` and `/events` still run as `DEFAULT_ORG` and can adopt `authenticate` unchanged.

## Command line

`bun run crate` (`src/cli/`); the README has the usage.

- **Through the API** (default): `POST /api/v1/designs` with the key from `--key` or
  `CRATE_API_KEY`, at `--api` or `CRATE_API_URL` (default `http://localhost:3000`). Writes
  `designs.json` (the answer) and `ranking.csv` (the shortlist, one row per configuration).
- **`--offline`:** runs the engine in the CLI's own process (no server, no database): the same
  `rankConfigurations`, so the same `designs.json` and `ranking.csv`, plus the recommended design's
  download package from `buildBundleZip` with the GLB's bytes: the crate GLB, the PDF, the cut list
  CSV(s), `design.json` and `README.txt`. With `--total` the package is for the whole batch (split
  evenly); without it, for one crate of the recommended quantity.
- Exit codes: 0 done, 1 failed (the API's or the app's message is printed), 2 bad arguments.

## Tests

| Where | Covers |
|---|---|
| `src/server/queue/queue.integration.test.ts` | 40 jobs drained by two workers (3 loops each): each run exactly once, both did work; concurrent claims skip locked rows; FIFO and `run_at`; kind filter; dedupe; NOTIFY wakes an idle worker (poll set to 60 s) within 2 s; polling alone picks a job up; a crashed worker's lease expires and another worker finishes the job (attempt 2), the late worker can't overwrite it; a long job keeps its lease; backoff 100 / 200 ms then `dead` with `onDead` once; permanent errors and unknown kinds dead-letter at once; the sweep job saves configurations, selects the recommendation and emits `configs.ready`; a dead sweep sets the job to `error` and emits `job.error`; the bundle stub dead-letters |
| `src/server/workers/pool.integration.test.ts` | Event-loop lag under 50 ms during three full sweeps; pool output equals the in-thread engine |
| `src/app/api/v1/designs/designs.integration.test.ts` | `/designs` with a key, from the UI, without a key (401), with a revoked or unknown key (401); same status and message as `/parts` for each bad upload; bad `total` and `freightRates`; nothing saved; `last_used_at` set |
| `src/server/workers/pool.test.ts` | Pool: size, FIFO, errors, a crashed thread replaced, timeouts, close (stand-in threads, no bundle) |
| `src/engine/sweep.test.ts`, `src/state/engineClient.test.ts` | The sweep call, its hash and schema, `rankConfigurations`; the browser client's sweep lane |
| `src/cli/args.test.ts`, `src/cli/run.test.ts` | Argument parsing; an offline run writes every file; the API path with a stubbed fetch |
| `src/server/auth.test.ts` | Key, UI marker, refusal rules |

## Known gaps

- Fair scheduling, per-org concurrency caps and quotas: deferred until a second org (#60).
- Jobs use the app's default rules and standards; per-job rules and the `shop_standard` table come
  with the jobs and standards slices.
