# Postgres data store

The shared store for parts, design jobs, configurations, generated files and events (#46). It
replaces the earlier SQLite WASM plan. Postgres and an S3-compatible blob emulator run in
Docker; the Next.js app runs on the host and reaches them through environment variables.

**Status (slice 1):** infrastructure, migrations, the first tables and the org-scoped repository
are in. Slice 1a adds the blob store's client, part uploads (`POST /api/v1/parts`) and presigned
model downloads: [BLOB_STORAGE.md](BLOB_STORAGE.md). Nothing in the UI reads or writes the
database yet; the event framework (LISTEN/NOTIFY, SSE) and the jobs API are later slices of #46.

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

To keep e2e or experiments from touching your dev data on the same server, set `DB_NAME`
instead (for example `DB_NAME=crate_designer_e2e`): `db:migrate` creates that database on first
use. The integration tests already do this on their own: each test file creates a throwaway
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
| `part` | Name, material, density, mass (kg), bounding size (3 columns, mm), model sha256, source (`catalog` or `upload`) |
| `part_model` | GLB metadata by content hash: sha256, size, object key, how it was validated. Keyed `(org_id, sha256)`. The bytes live in blob storage, never in Postgres |
| `design_job` | One per part being crated: part, optional total quantity, created by, status (`open`, `running`, `ready`, `error`, `archived`), selected configuration, notes, and a `version` for optimistic concurrency |
| `configuration` | Content-addressed by the engine's `input_hash`, **unique per `(org_id, input_hash)`**: job, quantity per crate, layout, settings JSON (validated with the Zod schemas on read), result summary, score, origin (`precomputed` or `user`), engine version. Never updated |
| `artifact` | A generated file for a configuration: kind (`glb`, `pdf`, `csv`, `zip`), sha256, size, object key, built by (`browser` or `server`). One per `(configuration, kind)` |
| `event` | Append-only outbox: `bigserial` id (the SSE replay cursor), job, type, small payload |
| `shop_standard` | Rates and limits (#19) as JSON, versioned per org |
| `idempotency_key` | Client-generated ids of changes already applied, with the request hash and the stored response, so an offline replay (slice 7a) applies a change once |

Not in slice 1: the `pg_notify` trigger on `event` and the job-queue table come with the event
and queue slices.

### Org scoping

The users are one org with many clients and projects (#60), so the prototype runs as a single
default org, but the scoping is built in from the first migration:

- **`org_id` on every root table.** Child rows reference their parent through a composite
  `(org_id, parent_id)` foreign key, so a job can't point at another org's part, nor a
  configuration at another org's job.
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
| `index.ts` | What route handlers use: `getRepository()`, `getDb()`, `closeDb()`, `inTransaction`, `DEFAULT_ORG`, `orgContext`, `OrgContext`, row types |
| `client.ts` | The pooled postgres.js client and drizzle handle, created on first use (so `next build` needs no database) |
| `repository.ts` | `createRepository(db)`: `parts`, `partModels`, `jobs` (with versioned `update`), `configurations` (content-addressed `save`), `events` (`append`, `listAfter`), `blobRefs` (`referenced`, for orphan cleanup); `inTransaction(db, repo => …)` |
| `org.ts` | `OrgContext`, `orgContext(id)`, `DEFAULT_ORG`, `requireOrg` |
| `schema.ts` | The drizzle tables |
| `config.ts` | `databaseUrl()` (from `DATABASE_URL`, or `DB_PORT` / `DB_NAME`), `loadLocalEnv()` |
| `migrate.ts` | `migrateDatabase(url)`, `ensureDatabase(url)`, `dropDatabase(url)` |

```ts
import { DEFAULT_ORG, getRepository } from "@/server/db";

const repo = getRepository();
const part = await repo.parts.create(DEFAULT_ORG, { name: "Bracket", massKg: 21.5, sizeXMm: 300, sizeYMm: 200, sizeZMm: 150, source: "upload" });
const job = await repo.jobs.create(DEFAULT_ORG, { partId: part.id, totalQuantity: 40 });
const updated = await repo.jobs.update(DEFAULT_ORG, job.id, job.version, { status: "ready" }); // undefined → stale, answer 409
```

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
