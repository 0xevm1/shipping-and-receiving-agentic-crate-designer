# HTTP API (`/api/v1`)

The server side of the crate designer (#46): parts, design jobs, saved configurations and live
events. Route Handlers live in `src/app/api/v1/` (Node.js runtime), their logic in `src/server/`,
and the request and response shapes are Zod schemas any client can import:
`src/lib/api/parts.ts`, `src/lib/api/jobs.ts` and `src/lib/events.ts`. The browser calls them
through `src/state/jobApi.ts` and `src/state/jobSync.ts`.

Storage and events are described in [POSTGRES.md](POSTGRES.md), GLB uploads and object keys in
[BLOB_STORAGE.md](BLOB_STORAGE.md), and the engine that designs and verifies crates in
[SPECIFICATION.md §5.1](SPECIFICATION.md#51-the-crate-engine-srcengine-46).

## Conventions

- **JSON in, JSON out.** Bodies are `application/json` (uploads: `multipart/form-data`). Anything
  else is `415`. Every response is `Cache-Control: private, no-store`.
- **Units:** mm and kg, as in the rest of the app (spec §4). Timestamps are ISO 8601 with offset.
- **Org.** There are no accounts yet: the UI's routes act for the default org, through
  `callerOrg(request)` in `src/server/auth.ts`, the one place auth will plug in. Another org's
  job, part or configuration answers exactly like a missing one (`404`).
- **API keys.** Routes scripts call (`POST /designs`) use `authenticate(request, …)` from the same
  file: `Authorization: Bearer <key>` (from `bun run apikey:create`) gives the key's org; the
  app's own pages (`Sec-Fetch-Site: same-origin`) act for the default org without one; anything
  else is `401 unauthorized`. A malformed, unknown or revoked key is `401` even from the UI. See
  [QUEUE.md](QUEUE.md#api-keys).
- **Idempotency.** `POST /jobs`, `POST /jobs/:id/configs` and `PATCH /jobs/:id` take an optional
  `Idempotency-Key` header (1 to 200 visible ASCII characters), a client-generated id per change.
  The first request's status and body are stored with the key (`idempotency_key` table, in the
  same transaction as the change) and returned for every repeat, even after a deploy. The same key
  with a different method, path or body is `422 idempotency_conflict`. Failed requests aren't
  stored, so they can be retried with the same key. The offline queue (#46 slice 7a) sets it.

### Errors

Every error has the same shape (`ApiErrorSchema`):

```json
{ "error": { "code": "result_mismatch", "message": "One sentence for the user.", "field": "summary" } }
```

| Status | `code` | When | Client should |
|---|---|---|---|
| 400 | `invalid_request` | The body doesn't match the schema; an unusable `Idempotency-Key` | Fix the request |
| 401 | `unauthorized` | `POST /designs` without an API key from outside the app, or with a malformed, unknown or revoked one | Send a valid `Authorization: Bearer <key>` |
| 404 | `not_found` | No such job / part / catalog entry, or it belongs to another org; a malformed id | Treat as gone |
| 409 | `engine_version_mismatch` | A saved configuration was designed by another engine version. The body also has `engineVersion`, the server's (`EngineMismatchErrorSchema`) | **Reload** the page to get the server's engine, then save again |
| 409 | `version_conflict` | `PATCH` named a `version` the job has moved past. The body also has `job`, as it is now (`VersionConflictErrorSchema`) | Show what changed; let the user apply theirs again on the new version |
| 413, 415, 422 | `too_large`, `unsupported_file`, `invalid_glb` | Part uploads (see BLOB_STORAGE.md) | Show the message |
| 415 | `invalid_request` | Not `application/json` | Fix the request |
| 422 | `result_mismatch` | The server recomputed a configuration and got another `inputHash` (`field: "inputHash"`) or summary (`field: "summary"`) | Don't retry as is; reload (a tampered or corrupt result) |
| 422 | `invalid_request` | A selection that isn't one of the job's configurations; a design with no crate | Show the message |
| 422 | `idempotency_conflict` | The `Idempotency-Key` was used for a different request | Use a new key per change |
| 503 | `unavailable` | The engine's worker threads aren't available on this server (`/designs`) | Try later |
| 500 | `internal` | Anything else, database unreachable included. The message is generic; details go to the server log | Treat as offline and try later |

The browser treats network errors, timeouts and every 5xx as *offline*: it stops saving and keeps
designing, without showing an error (`src/state/jobApi.ts`).

## Endpoints

| Method | Path | Does |
|---|---|---|
| `POST` | `/parts` | Upload a part's GLB with its mass, material, density and name (BLOB_STORAGE.md) |
| `GET` | `/parts/:id/model` | A ~5 min presigned URL for the part's GLB (`?redirect=1`: a 302 to it) |
| `POST` | `/jobs` | Open a design job for a part, or reuse the part's open one |
| `GET` | `/jobs/:id` | Snapshot: job, part, configurations, artifacts, `lastEventId` |
| `POST` | `/jobs/:id/configs` | Save a configuration made in the browser; the server recomputes it first |
| `PATCH` | `/jobs/:id` | Change the selection (recommendation), status, notes or total quantity, at a `version` |
| `POST` | `/designs` | Stateless headless calculation: a GLB and the part's facts in, the ranked configurations, recommendation, 1–200 curve and (with `total`) the even split out. Nothing saved; needs an API key from scripts. Runs on the engine's worker threads ([QUEUE.md](QUEUE.md#post-apiv1designs)) |
| `GET` | `/events?job=:id` | The job's events as Server-Sent Events, resumable with `Last-Event-ID` (POSTGRES.md "Events") |
| `GET` | `/health` | Database and event-listener liveness |

Coming in other slices of #46: artifact downloads
(`/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}`) and `GET /jobs/:id/bundle.zip`.

### `POST /api/v1/jobs`

```json
{ "catalogId": "PART-001", "totalQuantity": 40, "reuse": true }
{ "partId": "5f0c…", "reuse": true }
```

Name the part by exactly one of `partId` (a part already on the server, e.g. from `POST /parts`)
or `catalogId` (a `src/data/parts.json` entry; the server registers it as a `catalog` part the
first time, one row per org and id, and emits `part.created`). `totalQuantity` is optional.

With `reuse: true`, the newest job that isn't `archived` for **the same part identity** (the same
part, the same catalog entry, or an upload of the same GLB by sha256) is returned with `200` and
`created: false`, so two tabs that load the same part meet on one job. Concurrent requests for one
identity are serialised with an advisory lock. Otherwise a new job is created: `201`, a
`Location` header, `created: true`, and a `job.created` event.

Response (`CreateJobResponseSchema`): `{ job: Job, created: boolean }`, where `Job` is
`{ id, partId, status, totalQuantity, selectedConfigurationId, notes, version, createdAt, updatedAt }`.

**Server-side sweep.** Opening a job queues its quantity sweep: an `onJobCreated` hook
(`src/server/queue/register.ts`) runs inside the creating transaction, before `job.created`, so
the queue row commits with the job. A queue worker (`bun run worker`, [QUEUE.md](QUEUE.md)) then
runs it on worker threads, saves the shortlist as `precomputed` configurations, sets the job to
`ready` with the recommendation selected (unless a selection was already made; this bumps the
job's `version`), and emits `configs.ready`. With no worker running the sweep stays queued; the
browser still runs its own sweep for the Rules hint (spec §7.16).

### `GET /api/v1/jobs/:id`

The job's snapshot, for first load and reconnects (`JobSnapshotSchema`):

| Field | |
|---|---|
| `job` | As above; `version` is what a `PATCH` must send |
| `part` | The part (`PartResponseSchema`), with `catalogId` for catalog parts |
| `configurations` | Every configuration linked to the job, oldest first: `{ id, inputHash, engineVersion, quantityPerCrate, layout, score, origin, summary, design, createdAt, addedAt }`. `summary` is the engine's `DesignSummary`; `design` is what to put back on screen (`settings`, `layoutKey`, `ranking`); `score` is crate cost per part in USD; `origin` is `user` or `precomputed` |
| `artifacts` | Generated files of those configurations (`{ id, configurationId, kind, sha256, sizeBytes, builtBy, createdAt }`) |
| `lastEventId` | The newest event id this job's stream would send |
| `engineVersion` | The server's `ENGINE_VERSION`; a client running another one should reload before saving |

`lastEventId` is read **before** the rows, so a client that snapshots and then subscribes with
`subscribeJobEvents(id, onEvent, { lastEventId })` never misses a change; at worst it sees an
event for something the snapshot already holds.

### `POST /api/v1/jobs/:id/configs`

Saves a configuration designed in the browser (`SaveConfigurationRequestSchema`):

```json
{
  "request": { "part": { … }, "settings": { … }, "standards": { … }, "layoutKey": null, "ranking": "volume" },
  "engineVersion": "0.1.0+engine.1",
  "inputHash": "9f2c…",
  "summary": { "quantity": 4, "split": false, "crates": [ … ], "totals": { … }, "problem": null }
}
```

`request` is the engine's `DesignRequest` (the part's design fields only: id, name, mass, size,
material and the measured profile); `engineVersion`, `inputHash` and `summary` are its answer.
The browser builds it with `configurationBody` (`src/state/jobSync.ts`).

The server never trusts the result (`src/server/jobs/verify.ts`):

1. `engineVersion` must be the server's, else `409 engine_version_mismatch`. The tab reloads.
2. `request` must parse as a `DesignRequest`, else `400`.
3. It runs `designShipment(request)` (~15 ms with a measured profile) and compares its
   `inputHash` and its summary (as canonical JSON) with the body's. Any difference is
   `422 result_mismatch`, and nothing is stored.
4. A design with no crate is `422 invalid_request`.

Then, in one transaction: the configuration row (content-addressed by `(org, inputHash)`, so the
same inputs saved from any job or tab are one row), the link to this job
(`job_configuration`, origin `user`), and, only when the link is new, a `config.added` event
(last). The answer is `201` with `created: true`, or `200` with `created: false` when the job
already had it (no new row, no event). Body: `{ configuration, created }`
(`SaveConfigurationResponseSchema`).

The stored row keeps the whole request in `configuration.settings`, so the server can recompute
it later, plus the summary, `quantity_per_crate` and `layout` of the first crate type, the score
and the engine version. The request is authoritative for the design; it isn't checked against the
job's `part` row (a user may have changed the mass after loading).

### `PATCH /api/v1/jobs/:id`

```json
{ "version": 3, "selectedConfigurationId": "c1d2…", "notes": "Ship Tuesday" }
```

`version` is the one the client read; at least one of `selectedConfigurationId` (null clears it),
`status` (`open`, `running`, `ready`, `error`, `archived`), `notes` and `totalQuantity` must be
there. The job row is locked, then:

- a stale `version` is `409 version_conflict` with the current `job`;
- a selection that isn't linked to this job is `422` (the database enforces it too: the
  selection's foreign key points at `job_configuration`);
- otherwise the job is updated, `version` goes up by one, and `200 { job }` comes back. When the
  selection changed, `recommendation.changed` is emitted with the new `configurationId`.

## Events

Writes emit events in the same transaction, as its last statements (POSTGRES.md "Writing"):

| Emitted by | Type | Job | Payload |
|---|---|---|---|
| `POST /parts`; `POST /jobs` registering a catalog part | `part.created` | none (org-wide) | `partId` |
| `POST /jobs` creating a job | `job.created` | the job | `partId` |
| `POST /jobs/:id/configs` adding a configuration to the job | `config.added` | the job | `configurationId`, `inputHash` |
| `PATCH /jobs/:id` moving the selection | `recommendation.changed` | the job | `configurationId` (null when cleared) |
| The queue's sweep job (QUEUE.md) | `configs.ready` | the job | `count`, `recommendedConfigurationId`, `inputHash` |
| The queue, when a sweep is dead-lettered | `job.error` | the job | `message` (generic; the cause is in `queue_job.last_error`) |
| Artifacts (later slice) | `artifact.ready` | the job | see POSTGRES.md |
| A deploy with a new engine (later slice) | `engine.updated` | none (org-wide) | `engineVersion` |

The browser re-reads the snapshot when a job event arrives (several at once cause one read), and
shows the reload prompt on an `engine.updated` naming another engine version.

## The browser (`src/state/jobSync.ts`)

- **When a part loads**, `startJobSync` (started by `SavedStateLoader` once the restored crate is
  on screen) makes sure the server has a job for it: a catalog part by `catalogId`, a loaded GLB
  uploaded once per page through `POST /parts`, then `POST /jobs` with `reuse: true`. It reads the
  snapshot and subscribes to the job's events. Edits never touch the network; the engine stays in
  the browser.
- **Saving** is explicit: the Overview's *Shared job* section posts the crate on screen
  (`saveCurrentDesign` → `saveConfiguration(jobId, body, { idempotencyKey })`). That function is
  the single save path the offline queue will wrap; it resolves to `saved`, `offline`, `reload` or
  `rejected` and never throws.
- **Other tabs** see a save through `config.added` within about half a second of the request
  (LISTEN/NOTIFY, SSE, one snapshot read).
- **Without a server** (no network, server down, database down) the section says so, *Save to
  job* is disabled, everything else works, and it tries again every 15 s.
- **Version skew**: a `409 engine_version_mismatch`, a snapshot with another `engineVersion` or an
  `engine.updated` event shows "A newer version of the crate designer is running. Reload to keep
  saving." with a Reload button.

## Tests

`src/app/api/v1/jobs/jobs.integration.test.ts` (`bun run test:integration`) calls the Route
Handlers against a scratch database: snapshot, save and verify, tampered result and hash (422),
engine version (409), idempotent saves (same body twice; same `Idempotency-Key`, also
concurrently; a reused key with another body), stale `PATCH` (409), a selection from another job
(422), `config.added` on the SSE route, `onJobCreated` hooks, and another org's job (404).
`src/server/jobs/verify.test.ts`, `src/state/jobApi.test.ts` and `src/state/jobSync.test.ts` are
unit tests.
