# Postgres data store

The shared store for parts, design jobs, configurations, generated files and events (#46).
Postgres and an S3-compatible blob emulator run in Docker; the Next.js app runs on the host and
reaches them through environment variables. Postgres is also the event bus (LISTEN/NOTIFY, below)
and the job queue ([QUEUE.md](QUEUE.md)), so there is no Redis or broker to run.

The other server docs: every endpoint and event type in [API.md](API.md), GLBs and generated files
in [BLOB_STORAGE.md](BLOB_STORAGE.md), the job queue, worker threads, API keys and the CLI in
[QUEUE.md](QUEUE.md), and how they fit together in
[SPECIFICATION.md §5.2](SPECIFICATION.md#52-the-server-46) and §9.

## Quick start

Requires Docker (Desktop, or Engine with the compose plugin).

```bash
bun install
bun run dev                # infra:up + db:migrate, then next dev
```

`bun run dev` prints the database URL, the S3 endpoint and the blob console URL before Next.js
starts. `bun run dev:app` starts Next.js alone, without touching Docker.

## Scripts

| Command | What it does |
|---|---|
| `bun run infra:up` | `docker compose up -d --wait`: Postgres and the blob emulator healthy, then waits for `blob-init` to create the buckets and apply CORS. Prints the URLs. `db:up` is an alias |
| `bun run infra:down` | `docker compose down`. Data stays in the named volumes; `bun run infra:down -- -v` wipes them. `db:down` is an alias |
| `bun run db:migrate` | Creates the database if it doesn't exist, then applies `db/migrations/` |
| `bun run db:reset` | Drops the database and migrates it again. **Deletes its data** |
| `bun run db:psql` | `psql` inside the `db` container, on the configured database |
| `bun run db:generate` | After editing `src/server/db/schema.ts`: writes the next migration (`drizzle-kit generate`). Commit it with the schema change |
| `bun run test:integration` | The `*.integration.test.ts` files, against the Docker Postgres and blob emulator. Run `infra:up` first |
| `bun run worker` | The job queue worker (`queue_job`, SKIP LOCKED, NOTIFY `crate_jobs`). See [QUEUE.md](QUEUE.md) |
| `bun run apikey:create -- --name x` | Creates an API key (`api_key`, hashed) for scripts; `apikey:list`, `apikey:revoke -- --id …`. See [QUEUE.md](QUEUE.md#api-keys) |
| `bun run blob:gc` | Deletes blob objects no row names, older than 24 h (`-- --dry-run` lists them). See [BLOB_STORAGE.md](BLOB_STORAGE.md#orphan-cleanup-bun-run-blobgc) |

`bun run build`, `bun run test` and the pre-commit hook never need Docker.

## Environment

Every value has a default that matches `docker-compose.yml`, so a fresh clone needs no
`.env.local`. `.env.example` lists them; copy it to `.env.local` (git-ignored) to change any.
Next.js, the bun scripts, `vitest.integration.config.mts` and `drizzle.config.ts` all read
`.env.local`; a variable already set in the shell wins over the file.

| Variable | Default | Used by |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `crate-designer` | Docker container and volume names |
| `DB_PORT` | `5432` | Postgres host port, and the derived `DATABASE_URL` |
| `DB_NAME` | `crate_designer` | Database name, and the derived `DATABASE_URL` |
| `DATABASE_URL` | built from the two above: `postgres://crate:crate@localhost:$DB_PORT/$DB_NAME` | The app, scripts and tests. Set it for a hosted Postgres; it then wins over `DB_PORT` / `DB_NAME` |
| `DB_POOL_MAX` | `10` | Connections in the app's pool |
| `BLOB_PORT` | `9000` | S3 API host port |
| `BLOB_CONSOLE_PORT` | `9001` | Blob emulator console host port |
| `BLOB_ENDPOINT` | `http://localhost:9000` | S3 endpoint (follows `BLOB_PORT`; change both) |
| `BLOB_REGION` | `us-east-1` | S3 region |
| `BLOB_BUCKET` | `crate-designer-dev` | Bucket for this environment (`crate-designer-test` for e2e and CI) |
| `BLOB_ACCESS_KEY_ID` / `BLOB_SECRET_ACCESS_KEY` | `crate-dev` / `crate-dev-secret` | The emulator's only identity (compose reads them too). Server-only: never `NEXT_PUBLIC_` |
| `BLOB_FORCE_PATH_STYLE` | `true` | Path-style URLs, which the emulator needs |
| `BLOB_PUBLIC_ENDPOINT` | `BLOB_ENDPOINT` | Optional: the endpoint written into presigned URLs, when the browser reaches the store by another host |

Pointing the `BLOB_*` variables at AWS S3, Cloudflare R2 or GCS (HMAC keys) works without code
changes; [BLOB_STORAGE.md](BLOB_STORAGE.md#one-api-s3) has the values for each.

The local credentials (`crate` / `crate`, `crate-dev`) are for the Docker services only. Every
host port binds to `127.0.0.1`.

### Parallel worktrees and e2e

Two checkouts running Docker at once need their own project name and ports, as `E2E_PORT` does
for Playwright (#44). Put them in the worktree's `.env.local`:

```bash
COMPOSE_PROJECT_NAME=crate46
DB_PORT=55432
BLOB_PORT=59000
BLOB_CONSOLE_PORT=59001
BLOB_ENDPOINT=http://localhost:59000
```

To keep experiments from touching your dev data on the same server, set `DB_NAME` instead (for
example `DB_NAME=crate_designer_scratch`): `db:migrate` creates that database on first use.
`bun run e2e` does this by itself: `playwright.config.ts` starts the infrastructure, migrates
`crate_designer_e2e` (`E2E_DB_NAME`) on the same server and serves the app against it and the
`crate-designer-test` bucket, so a run never wipes or fills the dev database. The integration tests already do this on their own: each test file creates a throwaway
database named `<DB_NAME>_it_<label>_<random>`, migrates it and drops it.

## Services (`docker-compose.yml`)

| Service | Image | Host port | Notes |
|---|---|---|---|
| `db` | `postgres:18.6-alpine3.24` | `DB_PORT` → 5432 | Volume `db-data`; healthcheck `pg_isready` |
| `blob` | `chrislusf/seaweedfs:4.51` (`weed mini`) | `BLOB_PORT` → 8333 (S3), `BLOB_CONSOLE_PORT` → 12535 (console) | Volume `blob-data`; healthcheck `GET /healthz`; anonymous requests get 403 |
| `blob-init` | `amazon/aws-cli:2.39.2` | none | One-shot: creates `crate-designer-dev` and `crate-designer-test` and applies `infra/blob-cors.json` (browser `GET` / `HEAD` of presigned URLs). Idempotent |

Images are pinned to exact tags (#23).

### Blob emulator

MinIO was the first choice, but its images are no longer published on Docker Hub (`minio/minio`
is gone; the community edition is now source-only), so a pinned MinIO image can't be pulled. The
emulator is **SeaweedFS** in its all-in-one `mini` mode, one of the issue's fallbacks: an
upstream image with versioned tags, the S3 API with signature checks, bucket CORS and
presigned URLs (all checked when it was chosen), and an admin console for looking at objects.
The app codes against the S3 API only, so swapping the emulator (or pointing `BLOB_*` at AWS S3,
R2 or GCS's S3 API) needs no code changes. The console has no login and is bound to localhost;
don't publish its port elsewhere.

## Tables

The schema is `src/server/db/schema.ts`; `db/migrations/` is generated from it.

| Table | Holds |
|---|---|
| `org` | Organisations. The first migration seeds one, `DEFAULT_ORG_ID` (`00000000-0000-4000-8000-000000000001`, slug `default`) |
| `part` | Name, material, density, mass (kg), bounding size (3 columns, mm), model sha256, source (`catalog` or `upload`), and for catalog parts the `catalog_id` (unique per org, so a catalog part is registered once) |
| `part_model` | GLB metadata by content hash: sha256, size, object key, how it was validated. Keyed `(org_id, sha256)`. The bytes live in blob storage, never in Postgres |
| `design_job` | One per part being crated: part, optional total quantity, created by, status (`open`, `running`, `ready`, `error`, `archived`), selected configuration, notes, and a `version` for optimistic concurrency |
| `configuration` | Content-addressed by the engine's `input_hash`, **unique per `(org_id, input_hash)`**: quantity per crate, layout, the whole `DesignRequest` as `settings` JSON (validated with `DesignRequestSchema` on read), result summary, score (crate cost per part, USD), engine version. Never updated. Not owned by a job: jobs that reach the same inputs share the row |
| `job_configuration` | Which configurations a job has: `(org_id, job_id, configuration_id)` and how it got there, `origin` (`precomputed` by a sweep, or saved by a `user`). A job's `selected_configuration_id` references this table, so a job can only select one of its own |
| `artifact` | A generated file for a configuration: kind (`glb`, `pdf`, `csv`, `zip`), sha256, size, object key, built by (`browser` or `server`). One per object key (`(org, object_key)` unique): the key is content-addressed, so a configuration has one row per file and engine version; a bundle (`zip`) row names its first configuration |
| `event` | Append-only outbox: `bigserial` id (the SSE replay cursor), job, type, small payload |
| `shop_standard` | Rates and limits (#19) as JSON, versioned per org: rows are never updated, a save inserts the next `version` (`(org_id, version)` unique). The org's newest row is what the server designs with; none means `DEFAULT_STANDARDS` ([API.md](API.md#shop-standards)) |
| `engine_release` | Engine versions this deployment has started (`engine_version` primary key, first start time). Server-wide, not org data; see [Engine updates](#engine-updates) |
| `idempotency_key` | Client-generated ids of changes already applied, with the request hash and the stored response, so an offline replay (slice 7a) applies a change once |

The `event` table has an `AFTER INSERT` trigger that NOTIFYs `crate_events` (see
[Events](#events)). The job-queue table comes with the queue slice.

### Org scoping

The users are one org with many clients and projects (#60), so the prototype runs as a single
default org, but the scoping is built in from the first migration:

- **`org_id` on every root table.** Child rows reference their parent through a composite
  `(org_id, parent_id)` foreign key, so a job can't point at another org's part, nor a
  job_configuration link at another org's job or configuration.
- **Content-addressed keys are per org.** `part_model (org_id, sha256)` and
  `configuration (org_id, input_hash)`; nothing is looked up by hash alone.
- **No query without an `OrgContext`.** Application code reaches the database only through the
  repository in `src/server/db/repository.ts`, whose every method takes an `OrgContext` first and
  filters or stamps `org_id` from it. An `OrgContext` comes only from `orgContext(id)` (once the
  caller has authorised the org) or `DEFAULT_ORG`; a plain `{ orgId }` object fails to compile
  (the type is branded) and is refused at run time (`MissingOrgContextError`).
- **Deferred** until a second org shares a deployment: row-level security, per-org NOTIFY
  channels, fair queue scheduling between orgs and per-org quotas.

Blob object keys are org-scoped too: `org/<orgId>/models/<sha256>.glb`,
`org/<orgId>/artifacts/<inputHash>/<engineVersion>/…`, `org/<orgId>/bundles/<id>.zip`, built only
from an `OrgContext` (`src/server/blob/keys.ts`, [BLOB_STORAGE.md](BLOB_STORAGE.md#object-keys)).

## Code (`src/server/db/`)

`src/server/` is server-only (the blob store is `src/server/blob/`, [BLOB_STORAGE.md](BLOB_STORAGE.md)). ESLint keeps it, and the `postgres` / `drizzle-orm` / `@aws-sdk/*` packages, out
of `src/domain`, `src/lib`, `src/state` and `src/components`; only `src/app` (Route Handlers,
Server Components) may import it. `client.ts` also imports `server-only`, so a Client Component
that reached it would fail the build.

| File | Exports |
|---|---|
| `index.ts` | What route handlers use: `getRepository()`, `getSystemQueries()`, `getDb()`, `closeDb()`, `inTransaction`, `DEFAULT_ORG`, `orgContext`, `OrgContext`, row types |
| `client.ts` | The pooled postgres.js client and drizzle handle, created on first use (so `next build` needs no database) |
| `repository.ts` | `createRepository(db)`: `parts`, `partModels`, `jobs` (with versioned `update`), `configurations` (content-addressed `save`), `events` (`append`, `listAfter`, `listForStream`), `blobRefs` (`referenced`, for orphan cleanup); `inTransaction(db, repo => …)` |
| `org.ts` | `OrgContext`, `orgContext(id)`, `DEFAULT_ORG`, `requireOrg` |
| `schema.ts` | The drizzle tables |
| `config.ts` | `databaseUrl()` (from `DATABASE_URL`, or `DB_PORT` / `DB_NAME`), `loadLocalEnv()` |
| `migrate.ts` | `migrateDatabase(url)`, `ensureDatabase(url)`, `dropDatabase(url)` |
| `system.ts` | `createSystemQueries(db)`: `ping`, `notificationQueueUsage`, `notify`. No table data, so no `OrgContext` |

```ts
import { DEFAULT_ORG, getRepository } from "@/server/db";

const repo = getRepository();
const part = await repo.parts.create(DEFAULT_ORG, { name: "Bracket", massKg: 21.5, sizeXMm: 300, sizeYMm: 200, sizeZMm: 150, source: "upload" });
const job = await repo.jobs.create(DEFAULT_ORG, { partId: part.id, totalQuantity: 40 });
const updated = await repo.jobs.update(DEFAULT_ORG, job.id, job.version, { status: "ready" }); // undefined → stale, answer 409
```

## Events

Live updates (#46 §3): a write that clients care about adds a row to the `event` outbox in its
own transaction, Postgres NOTIFYs on commit, and each Next.js process fans that out to the
browsers watching the job over Server-Sent Events.

```
route handler ── inTransaction: change + emitEvent ──▶ event row ──trigger──▶ pg_notify('crate_events')
                                                                                   │ (on commit)
browser ◀── SSE /api/v1/events?job=… ◀── job feed (one read per job) ◀── hub ◀── one LISTEN connection per process
```

### Writing: `emitEvent`

```ts
import { DEFAULT_ORG, getDb, inTransaction } from "@/server/db";
import { emitEvent } from "@/server/events";

await inTransaction(getDb(), async (tx) => {
  const saved = await tx.configurations.save(DEFAULT_ORG, input);
  await emitEvent(tx, DEFAULT_ORG, { jobId, type: "config.added", payload: { configurationId: saved.row.id, inputHash: input.inputHash } });
});
```

- **Same transaction.** The trigger on `event` (`db/migrations/0002_event_notify.sql`) calls
  `pg_notify`, which Postgres delivers only when the transaction commits: a rollback sends
  nothing, a commit always sends.
- **One event per user action**, written **last** in the transaction. `events.append` takes a
  transaction-level advisory lock (`EVENT_ORDER_LOCK`) in the same statement as the insert
  (`with ordered as (select pg_advisory_xact_lock(…)) insert … select … from ordered`, so the
  lock comes before `nextval`), and event-writing transactions commit in id order. Without it, a
  transaction holding id 10 could commit after one holding id 11, and a client already past 11
  would never see 10. The lock is held until commit, which is why the event goes last; one
  statement rather than lock, then insert, saves round trips while it is held.
- **Expensive work before the transaction.** A save's engine recompute runs in the engine
  worker pool before its transaction opens (`saveConfiguration`), so no pool connection, and no
  ordering lock, waits on CPU work.
- **Validated.** The payload is checked against its type's Zod schema and a 4 KB cap
  (`src/lib/events.ts`); job-scoped types need a `jobId`. A bad event fails the transaction.

### Channel and payload

One channel, `crate_events`, for every org (`CRATE_EVENTS_CHANNEL`). The NOTIFY payload is
`{"id", "orgId", "jobId", "type"}`, a few dozen bytes. Receivers read the row (and its payload)
from the `event` table by id. Per-org channels are deferred with RLS (#60): every process
receives every org's notifications and filters them in memory.

### Event types

| Type | Job | Payload (required fields; extra fields allowed) |
|---|---|---|
| `part.created` | optional | `partId` |
| `job.created` | yes | `partId` |
| `configs.ready` | yes | `count`: the sweep finished; shortlist and curve are saved |
| `config.added` | yes | `configurationId`, `inputHash`: a user saved a configuration |
| `recommendation.changed` | yes | `configurationId` (null when cleared) |
| `artifact.ready` | yes | `artifactId`, `configurationId`, `kind`, plus `file` or `bundleId`: a server-built file is stored (docs/API.md "Artifacts") |
| `job.error` | yes | `message` (safe to show) |
| `engine.updated` | no (org-wide) | `engineVersion`: a server started on a new engine; open tabs on another one should reload ([Engine updates](#engine-updates)) |

Events with no job (`engine.updated`, a job-less `part.created`) go to every stream of that org.

### Engine updates

When a Next.js server starts, `src/instrumentation.ts` calls `announceEngineOnStart`
(`src/server/engine/announce.ts`). In one transaction it inserts the running `ENGINE_VERSION` into
`engine_release` (`on conflict do nothing`) and, only if that inserted a row, emits one org-wide
`engine.updated { engineVersion }` per org (`src/server/db/engineRelease.ts`). The primary key makes
it once per version across instances: of several servers starting together, one inserts and the
rest wait on its row and insert nothing. A restart, or a rollback to a version already recorded,
announces nothing; those tabs still learn of the mismatch from the `409 engine_version_mismatch` on
their next save. It doesn't hold up startup (not awaited), opens one short-lived connection of its
own, and only logs if the database is down; then that start announces nothing. The browser shows
the reload prompt when the version differs from its own ([API.md](API.md#events)).

### Listening: `EventBus`

`src/server/events/` holds the `EventBus` interface (`start`, `stop`, `subscribe(jobId, subscriber)
→ unsubscribe`, `status`) and its Postgres implementation, `createPgEventBus`.
`getEventBus()` is the process-wide one, kept on `globalThis` (dev hot reloads reuse it) and
started on first use.

- **One dedicated connection per process**, outside the pool: postgres.js `sql.listen` on a
  client of its own, `application_name = crate-events-listener` in `pg_stat_activity`.
- **Reconnects.** postgres.js re-issues `LISTEN` once when the connection drops, but gives up
  silently if that attempt fails (Postgres still restarting). So the bus probes itself: every
  15 s it NOTIFYs a probe token through the pool and expects it back within 5 s of that NOTIFY
  committing. Two misses in a row (`probeMisses`; a failed NOTIFY counts as one) mean the
  listener is dead or half-open; the bus opens a new one, retrying with exponential backoff
  (250 ms doubling to 10 s, with jitter). A failed attempt is logged with the error's code and
  nested errors (a refused connect to `localhost` is an `AggregateError` with an empty message).
- **The probe tolerates overload.** Time spent waiting for a pool connection doesn't count (the
  5 s starts at commit), the verdict waits for pending I/O (`setImmediate`) so a probe already
  on the socket of a lagging event loop is read first, and one miss alone never reconnects.
  Before this, a saturated process tore down a healthy listener and made every stream resync
  (LOAD_TEST.md).
- **No gaps after a drop.** Each LISTEN after the first tells every subscriber to resync: SSE
  streams re-read the table from their cursor, picking up anything committed while nobody was
  listening.
- **One subscriber per job, not per stream.** The SSE streams of a job share a feed
  (`src/server/events/feed.ts`): on a notification it reads the new rows once, encodes each
  message once and hands the batch to every stream of the job (an org-wide event: one read per
  job). One save to a job with 50 open tabs is one query, not 50.
- **Slow subscribers are dropped**, never waited for. Each subscriber has its own queue
  (256 by default); one that falls that far behind is removed. The listener itself only
  pushes to queues, so it keeps reading and the NOTIFY queue keeps draining.

### `GET /api/v1/events?job=<id>`

A Server-Sent Events stream (`text/event-stream`, Node.js runtime, never cached):

1. **Org check first.** A job outside the caller's org answers 404, like a missing one, before
   anything subscribes. (One default org until there are accounts.)
2. **Subscribe, then replay.** The stream subscribes to the bus, then sends every event with
   `id > Last-Event-ID` from the table (`events.listForStream`: the job's events and the org's
   job-less ones), in pages of 500.
3. **Live.** The job's feed reads each notification's new rows once and hands every stream the
   batch with the id it starts after. A stream whose cursor is at or past that id writes the
   events it hasn't sent; one that is behind (still replaying, or joined after the feed read
   past it), or any stream after a resync or a failed shared read, reads the table again from
   its own cursor. Rows always come from the table, in id order, with nothing sent twice and
   each stream keeping its own `Last-Event-ID`.

Every message has `id: <event id>` and `data: {"id", "jobId", "type", "payload", "createdAt"}`
(`JobEventMessageSchema`). The browser resends the last id as `Last-Event-ID` when it
reconnects; `?lastEventId=` does the same for clients that can't set headers (the header wins).
A `: heartbeat` comment goes out every 15 s, `retry: 2000` sets the reconnect delay, and the
subscription ends when the client goes away. A client that stops reading is cut off after 1000
queued messages and catches up when it reconnects.

In the browser, `subscribeJobEvents(jobId, onEvent, { onOpen, onError })` (`src/lib/jobEvents.ts`)
wraps EventSource, reopens it with `?lastEventId=` if it closes for good, and drops ids it has
already delivered.

### `GET /api/v1/health`

`200 {"ok": true, "db": {"ok", "latencyMs"}, "notificationQueue": {"usage", "alert"}, "events": …, "eventLoop": …}`
when the database answers within 2 s, `503` with `ok: false` when it doesn't. `events` is this
process's listener status (null until something subscribes). `eventLoop` is this process's
event-loop delay (`mean`, `p50`, `p99`, `max` in ms) and utilisation (0–1) over the last 1 s
window (`src/server/eventLoop.ts`; null on the very first request): every SSE stream and save
shares that loop, so it is the first thing to rise under load ([LOAD_TEST.md](LOAD_TEST.md)).
The offline queue (slice 7a) uses the endpoint as its liveness check.

### Limits

- **8 KB NOTIFY payloads.** Ours are ids only; event payloads are capped at 4 KB and read from
  the table.
- **Commits that NOTIFY are serialised.** Postgres takes a database-wide lock to commit a
  transaction that notified, and `events.append` orders event commits as well. Keep those
  transactions short and write one event per user action, not one per row.
- **One shared NOTIFY queue** (8 GB by default). A listener that stops reading holds it; when it
  fills, every NOTIFY, so every event write, fails. `pg_notification_queue_usage()` is in
  `/api/v1/health` and read on every bus probe, with a warning logged at 50 %
  (`NOTIFY_QUEUE_ALERT_RATIO`).
- **No transaction-mode pooler.** LISTEN is session state: PgBouncer in transaction mode (and
  similar proxies) breaks it. The listen connection must go straight to Postgres.
- **Primary only.** A read replica doesn't receive the primary's notifications.
- **Delivery isn't guaranteed**, and identical payloads in one transaction merge. Ids make every
  payload distinct, and the `event` table is the source of truth: a client that misses
  notifications catches up by id.
- **Long-lived connections.** SSE needs a long-running Node server (no serverless or edge) and a
  proxy that doesn't buffer and has an idle timeout above the 15 s heartbeat.
- **Measured capacity.** Method, numbers before and after the fixes above, and the threshold
  for swapping the `EventBus` for a broker: [LOAD_TEST.md](LOAD_TEST.md), spec §9.1.

### Tests

`src/server/events/events.integration.test.ts` (with `bun run test:integration`): delivery after
commit and none on rollback, one listen connection outside the pool, a slow subscriber dropped
while others keep up, SSE replay after a reconnect with `Last-Event-ID` (small pages and writes
racing the replay) giving every missed event exactly once, `?lastEventId=`, org-wide events,
the org check, one read per commit for 20 streams of a job, recovery after
`pg_terminate_backend`, recovery after the listener is locked out for a while (postgres.js's own
retry fails; the probe and backoff bring it back), and the probe under overload (a pool too slow
to send it, an event loop blocked past its deadline: no reconnect; probes that never come back:
a reconnect after two). `repository.integration.test.ts` checks that a second event writer waits
on the ordering lock until the first commits. The hub, the job feed and SSE fan-out
(`feed.test.ts`, in memory), the event schemas and the browser helper have unit tests.
`src/server/engine/announce.integration.test.ts`: `engine.updated` once per org and version with
two servers starting at once, nothing on a restart, reaching every job's stream, and no throw with
the database down.

## Changing the schema

1. Edit `src/server/db/schema.ts`.
2. `bun run db:generate` writes `db/migrations/NNNN_*.sql` and its snapshot. For data changes or
   SQL drizzle can't express, `bunx drizzle-kit generate --custom --name <what>` gives an empty
   migration to fill in (the default-org seed is one).
3. `bun run db:migrate`, then `bun run test:integration`.
4. Commit the schema and the migration together. CI's `integration` job fails if
   `db:generate` would write anything.

Migrations are append-only once merged: fix a mistake with a new migration.

## CI

The `integration` job in `.github/workflows/ci.yml` starts the same `docker-compose.yml`
(`bun run infra:up`, not a `services:` block), checks that `db:generate` writes nothing,
migrates an empty database and runs `bun run test:integration`. `checks` runs
`docker compose config` to validate the file.
