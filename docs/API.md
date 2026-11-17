# HTTP API (`/api/v1`)

The server side of the crate designer (#46): parts, design jobs, saved configurations and live
events. Route Handlers live in `src/app/api/v1/` (Node.js runtime), their logic in `src/server/`,
and the request and response shapes are Zod schemas any client can import:
`src/lib/api/parts.ts`, `src/lib/api/jobs.ts`, `src/lib/api/artifacts.ts`, `src/lib/api/designs.ts`
and `src/lib/events.ts`. The browser calls them through `src/state/jobApi.ts` and
`src/state/jobSync.ts`; scripts through `bun run crate` ([QUEUE.md](QUEUE.md#command-line)).

This file is the reference for every endpoint and event type. The other server docs:

| Doc | Covers |
|---|---|
| [POSTGRES.md](POSTGRES.md) | Tables, org scoping, scripts, environment and ports, the event outbox, LISTEN/NOTIFY and the SSE route |
| [BLOB_STORAGE.md](BLOB_STORAGE.md) | The S3 API and providers, object keys, part uploads and their checks, presigned downloads, orphan cleanup, lifecycle |
| [QUEUE.md](QUEUE.md) | The engine's worker threads, the Postgres job queue and its job kinds, `POST /designs`, API keys, the command line |
| [LOAD_TEST.md](LOAD_TEST.md) | The load test (`bun run load`): measured limits of saves and live events, and when to move to a broker |
| [SPECIFICATION.md §5.2](SPECIFICATION.md#52-the-server-46) | How the pieces fit: the architecture diagram and the rules that hold across them |
| [SPECIFICATION.md §5.1](SPECIFICATION.md#51-the-crate-engine-srcengine-46) | The engine that designs and verifies crates, its stamps (`engineVersion`, `inputHash`) |

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
| 503 | `unavailable` | The engine's worker threads aren't available on this server (`/designs`, artifacts) | Try later |
| 500 | `internal` | Anything else, database unreachable included. The message is generic; details go to the server log | Treat as offline and try later |

The browser treats network errors, timeouts and every 5xx as *offline*: it keeps designing, keeps
saves on the device and sends them later, without showing an error (`src/state/jobApi.ts`, and
"Offline" below).

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
| `GET` | `/health` | Database and event-listener liveness, NOTIFY queue usage, event-loop lag |
| `GET` | `/standards` | The org's shop rates and limits (#19), or the shipped defaults when it has stored none ([Shop standards](#shop-standards)) |
| `PUT` | `/standards` | Store a new version of the org's standards, at a `baseVersion` ([Shop standards](#shop-standards)) |
| `GET` | `/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}` | One file of a saved configuration, built by the server on the first request and kept in blob storage; a presigned URL (`?redirect=1`: a 302 to it) ([Artifacts](#artifacts)) |
| `GET` | `/jobs/:id/bundle.zip?configs=…` | The job's configurations in one ZIP: a folder each, `manifest.json`, `comparison.pdf` (spec §7.17); 200 with a presigned URL, or 202 while the queue builds a large one ([Artifacts](#artifacts)) |

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
  "engineVersion": "0.1.0+engine.3",
  "inputHash": "9f2c…",
  "summary": { "quantity": 4, "split": false, "crates": [ … ], "totals": { … }, "problem": null }
}
```

`request` is the engine's `DesignRequest` (the part's design fields only: id, name, mass, size,
material and the measured profile); `engineVersion`, `inputHash` and `summary` are its answer.
The browser builds it with `configurationBody` (`src/state/jobSync.ts`).

The server never trusts the result: `src/server/jobs/verify.ts` sends the check to the engine's
worker threads (the pool's `verify` task, [QUEUE.md](QUEUE.md#worker-threads)), which run the
recompute and comparison in `src/server/jobs/check.ts` (`checkConfiguration`):

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

### Shop standards

`GET /api/v1/standards` returns the org's newest stored version, filled from the defaults for any
field added since, or `DEFAULT_STANDARDS` when the org has none. Shapes: `src/lib/api/standards.ts`.

```json
{ "standards": { "stock": { … }, "rates": { … }, … }, "version": 2, "source": "org", "updatedAt": "2026-11-17T09:00:00.000Z" }
```

`version` and `updatedAt` are null and `source` is `"default"` while the org has none.

`PUT /api/v1/standards` with `{ "standards": { … }, "baseVersion": 2 }` (null for the first save)
stores a complete standards object, validated with `ShopStandardsSchema` (a bad or missing field is
`400` with `field` such as `standards.stock.cleatMm.wide`), as the next version and returns it. A
`baseVersion` that is no longer the newest is `409 version_conflict` with the standards as they are
now in `current`. Versions are never overwritten. It emits no event.

**Who uses the server copy:** the queue's sweep job and `POST /designs` design with the caller's org
standards. A configuration saved from the browser carries the standards it was designed with in its
`request` and is recomputed with those, so it is unaffected. **The browser still works from its own
copy** (the Rules tab's Shop standards, kept in `localStorage`, spec §9) and doesn't read or write
this endpoint yet, so the two can differ until it does. Left for a later change: load the org's
standards at startup (keeping the local copy offline), save edits through `PUT`, and tell other tabs
with an event.

## Artifacts

Files built **by the server** from saved configurations (#46 slice 6; code in `src/server/artifacts/`,
shapes in `src/lib/api/artifacts.ts`). The engine builders are the browser's
(`buildArtifact`, `buildMultiBundleZip`, spec §7.17), so the bytes match what the page would make
for the same request, units and date.

### `GET /api/v1/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}`

- **Access:** the job must be the caller's org's and the configuration linked to that job. Another
  org's job, a configuration of another job, a malformed id or another file name: `404`.
- **What is built:** the configuration's stored `DesignRequest` (the one the server verified when
  it was saved, or the sweep job stored), by the **running** engine, with the job's part model
  read from blob storage (`part_model`; a catalog part's bundled GLB is stored there as a
  `part_model` of the org on first use, then read like an upload). Imperial units (the app's
  default), dated with the configuration's `createdAt` in UTC, so the same inputs and engine always
  give the same bytes.
- **First request:** built on the engine's worker threads (never the request thread), stored at
  `artifactKey(org, inputHash, engineVersion, file, modelSha256)` (`org/<orgId>/artifacts/<inputHash>/<engineVersion with + as _>/<file>`;
  `crate.glb` under one more segment, the part model's sha256 or `no-model`, because the GLB embeds
  the mesh and `inputHash` doesn't hash it, [BLOB_STORAGE.md](BLOB_STORAGE.md#object-keys);
  tagged `retention=ephemeral`), recorded as an `artifact` row (`built_by = server`, unique per
  object key), and `artifact.ready` is emitted on the job (`{ artifactId, configurationId, kind, file }`).
- **Later requests:** the row and the object are there, so nothing is built (`cached: true`). A row
  whose object has gone (a lifecycle rule) is rebuilt, never served as a dead link.
- **Concurrent first requests** build once: they share one build in the process, and processes
  serialise on a transaction-level advisory lock on the key (`artifacts.lock`); the second finds
  the first one's row and object. Because the bytes are deterministic, even a race past both guards
  would write the same object.
- **Answer** (`ArtifactUrlResponseSchema`), the same choice as `GET /parts/:id/model`: JSON
  `{ url, expiresAt, artifactId, kind, fileName, contentType, sha256, sizeBytes, engineVersion,
  inputHash, builtBy, cached }`, where `url` is a ~5 min presigned GET that downloads as
  `fileName`; or with `?redirect=1` a `302` to it, so an `<a href>` downloads straight from blob
  storage. No blob credentials are ever in a response.
- A GLB or CSV of a configuration with no crate: `422 invalid_request` (the PDF says why). The
  engine's thread bundle missing: `503 unavailable`.

### `GET /api/v1/jobs/:id/bundle.zip?configs=<id>,<id>,…`

The one-click download from the server: a folder per configuration (GLB per crate type, PDF,
CSV), `manifest.json` and `comparison.pdf`, exactly `buildMultiBundleZip` (spec §7.17).

- `configs`: configuration ids of the job, comma-separated or repeated, in the order wanted
  (duplicates and equal inputs once; at most 50). Absent: every configuration of the job, in the
  order they joined it. An id that isn't one of the job's: `404`. A job with none: `422`.
- **Key:** `bundleKey(org, "<bundleHash>-<modelSha256>-<engineVersion>")` (the bundle id), where
  `bundleHash` is the manifest's (SHA-256 of the input hashes joined by newlines) and `modelSha256`
  is the part model's (`no-model` without one), since the bundle's GLBs embed the mesh. An `artifact` row of kind `zip` names it (its
  `configuration_id` is the first configuration), so orphan cleanup keeps the object and the job's
  snapshot lists it. Dated with the newest configuration's `createdAt`.
- **Built during the request or queued (the choice):** up to **8** configurations
  (`BUNDLE_SYNC_MAX_CONFIGS`) are built during the request on the worker threads, which keeps the
  event loop free, so the request simply waits (a few seconds at most) and gets `200`. Larger
  bundles are **queued** (`enqueueBundle`, deduplicated by bundle id): `202`
  `{ status: "queued", bundleId, configurationIds, queueJobId }` with `Location` (the same URL)
  and `Retry-After: 5`; the queue's `bundle` job (`bun run worker`) builds and stores it and emits
  `artifact.ready` (`kind: "zip"`, `bundleId`). Ask the same URL again then. Without a running
  worker a queued bundle waits, like a sweep.
- **Ready:** `200` `{ status: "ready", bundleId, configurationIds, …the artifact fields above }`, or
  with `?redirect=1` a `302` to the presigned URL (a queued bundle still answers `202` JSON).

### Files built in the browser

The browser builds the same files itself (Export, Download all) and doesn't upload them.
**Caching browser-built files on the server (`built_by = browser`) is deferred:** the server
would have to rebuild anything that goes on a released record anyway (#46: files from a client
can't be trusted), and its own builds are cheap and content-addressed, so uploads would add a
trust path for little gain. The `built_by` column keeps the door open.

### In the UI

The Overview's *Shared job* section (`SharedJob.tsx`, `SharedJobFiles.tsx`): while the server is
live, each saved configuration links **GLB · PDF · CSV** from the server (`artifactHref`, a
redirect to the presigned URL), and **ZIP from the server** links `bundle.zip` (`bundleHref`).
**Download all saved** bundles the job's configurations in the page (`savedConfigRequests`, no
server needed, from the list as last seen); the Export pill's **Download all** bundles the design
on screen plus the job's saved configurations when there are any (`defaultConfigs`), else the
sweep's shortlist as before.

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
| A server-built file or bundle stored (first request, or the queue's bundle job) | `artifact.ready` | the job | `artifactId`, `configurationId` (a bundle's first), `kind` (`glb`, `pdf`, `csv`, `zip`), plus `file` or `bundleId` |
| The first server to start on a new engine version, once per org ([POSTGRES.md](POSTGRES.md#engine-updates)); an old tab also learns from the `409` on its next save | `engine.updated` | none (org-wide) | `engineVersion` |

The browser re-reads the snapshot when a job event arrives (several at once cause one read), and
shows the reload prompt on an `engine.updated` naming another engine version.

## The browser (`src/state/jobSync.ts`)

- **When a part loads**, `startJobSync` (started by `SavedStateLoader` once the restored crate is
  on screen) makes sure the server has a job for it: a catalog part by `catalogId`, a loaded GLB
  uploaded once per page through `POST /parts`, then `POST /jobs` with `reuse: true`. It reads the
  snapshot and subscribes to the job's events. Edits never touch the network; the engine stays in
  the browser.
- **Saving** is explicit and local first: the Overview's *Shared job* section queues the crate on
  screen (`saveCurrentDesign`), a recommendation (`selectConfiguration`) or the job's notes
  (`updateJob`) as a pending change on the device, and the queue sends it (see "Offline").
  `saveConfiguration(jobId, body, { idempotencyKey })` is still there for a direct save; it
  resolves to `saved`, `offline`, `reload` or `rejected` and never throws.
- **Other tabs** see a save through `config.added` within about half a second of the request
  (LISTEN/NOTIFY, SSE, one snapshot read).
- **Without a server** (no network, server down, database down) the section says so, saves are
  kept on the device, everything else works, and the health check probes until the server answers.
- **Version skew**: a `409 engine_version_mismatch`, a snapshot with another `engineVersion` or an
  `engine.updated` event shows "A newer version of the crate designer is running. Reload to keep
  saving." with a Reload button.

## Offline (#46 slice 7a)

The dock's Wi-Fi is poor, and the engine already runs in the browser, so saving works without the
server too. Code: `src/state/pendingChanges.ts` (the queue), `src/state/pendingSync.ts` (sending
it), `src/lib/liveness.ts` (is the server there?), `src/state/jobCache.ts` (jobs kept on the
device), wired together in `startJobSync` (`src/state/jobSync.ts`).

- **Local first.** Every save (a configuration, a recommendation, the notes; status and total
  quantity through `updateJob`) is written to `localStorage` under
  `crate-designer.pending-changes.v1` as a *pending change* **before** any network call, with a
  client-generated id (`crypto.randomUUID()`) that is sent as its `Idempotency-Key`. The UI treats
  it as saved at once. A configuration not yet on the server is listed with a **Not synced yet**
  badge and "on this device only"; a recommendation waiting to sync carries the same badge; and a
  banner counts the part's unsynced changes (and those of other parts), saying that nobody else
  sees them until they sync. If the browser refuses to store the queue (private window, quota) it
  is kept in memory for the page and the banner says it is lost when the page closes.
- **Behind an interface.** The queue is read and written through `PendingStore` (`read()`,
  `write(items)`), so IndexedDB can replace `localStorage` without touching the rest. Every read
  and write is in try/catch (`persist.ts`), each write is a read-modify-write of the stored list
  so tabs never overwrite each other, and the `storage` event makes other tabs re-read it.
- **Liveness, not `navigator.onLine`.** The server is reachable when the job's SSE stream opens or
  `GET /api/v1/health` answers 200. A failed request or a dropped stream starts the health probe:
  after 0.5 s, then doubling, capped at **3 s** (`LIVENESS_MAX_DELAY_MS`), so a server that comes
  back is noticed within about 3 s and the queue is sent within the 5 s promised, with no user
  action. The SSE stream can stay open while only the database is down (the Next.js server is
  up); the first save then fails with a 5xx, which marks the server unreachable.
- **Sending** (`flushPending`): oldest first; each change is removed only once the server confirms
  it. Offline stops the run and keeps everything. A change made before the part's job was known
  (a part opened offline) has `jobId: null` and is given the job when `POST /jobs` answers. A
  recommendation of a configuration that is itself still pending names it by `inputHash` and is
  resolved to its id when sent, after it. When a job change is confirmed, the job's later pending
  changes made on the same `version` move on to the new one.
- **Several tabs.** One tab sends at a time (the Web Locks API, `crate-designer.pending-sync`,
  `ifAvailable`); the others look again after 2 s. Where Web Locks don't exist two tabs may send
  the same change, which the idempotency key makes harmless: the server returns the first response.
- **Conflicts are kept, never dropped and never applied silently.** A pending `PATCH` that gets
  `409 version_conflict` is marked `conflict` with the job as the server has it; the section shows
  both and asks: **Keep mine** (sent again on the server's `version`, under a new key) or **Take
  theirs** (dropped). A change the server rejects otherwise (`422`, `404`) is kept with its message
  until the user discards it. Either way the job's later changes wait behind it, so a
  recommendation is never sent before the configuration it names; other jobs carry on.
- **Engine versions.** A `409 engine_version_mismatch` naming another engine than the tab's means
  this tab is the older one: configurations stop, the reload prompt shows, and the queue survives
  the reload in `localStorage`. After the reload a queued configuration made by the earlier engine
  meets the same `409`, now naming this tab's own engine: the tab redesigns it. If the result is
  the same it is re-stamped and sent (new key); if not it is marked **stale** and shown with what
  this version makes of it: **Save this version's result** or **Discard**. It is never sent as is
  and never lost. The server verifies every synced configuration as usual.
- **Opening a job offline.** The last-opened jobs (job row and configurations, JSON only) are kept
  under `crate-designer.job-cache.v1`: at most 5 jobs and about 1 MB, oldest dropped first. With
  the server stopped, reopening the app restores the crate (spec §9) and lists the job from this
  copy ("Showing the copy of this job kept on this device"), and quantity, layout and saves work.
  A part is found by its catalog id, or by the SHA-256 of its GLB, so a reopened custom part
  finds its job and its pending changes.
- **Limits.** A part GLB picked while offline stays in memory (its object URL) and is uploaded
  when the server answers; it does not survive a reload until it is uploaded (the IndexedDB copy
  of the last GLB, spec §9, brings the part back, and the upload happens then). `localStorage` is
  per browser: unsynced work on one tablet is invisible to everyone else until it syncs, which is
  why the marker says so.

## Tests

`src/app/api/v1/jobs/jobs.integration.test.ts` (`bun run test:integration`) calls the Route
Handlers against a scratch database: snapshot, save and verify, tampered result and hash (422),
engine version (409), idempotent saves (same body twice; same `Idempotency-Key`, also
concurrently; a reused key with another body), stale `PATCH` (409), a selection from another job
(422), `config.added` on the SSE route, `onJobCreated` hooks, and another org's job (404).
`src/app/api/v1/jobs/offline.integration.test.ts` runs the browser's queue sender against the same
handlers: a configuration replayed after a lost response, the same change sent by two tabs at
once, and a recommendation replayed after a lost response are each applied once.
`src/state/pendingChanges.test.ts`, `pendingSync.test.ts`, `jobCache.test.ts` and
`src/lib/liveness.test.ts` cover the queue (order, replay, reload, storage that throws), the
conflict and engine-version flows, the cache and the liveness backoff with fake timers.
`src/server/jobs/verify.test.ts`, `src/state/jobApi.test.ts` and `src/state/jobSync.test.ts` are
unit tests.

`src/app/api/v1/jobs/artifacts.integration.test.ts` covers the artifact and bundle routes: built
on the first request and then served from storage (one object, one row, one `artifact.ready`),
concurrent first requests (and the database lock alone, without the in-process single flight),
the GLB from the part model in blob storage reloading at the crate's outside size within 1 mm,
404s for another org's job, another job's configuration, bad ids and file names, the bundle's
folders, manifest and comparison PDF, the queued (202) path through the queue's bundle job,
precomputed configurations, orphan cleanup keeping bundle objects, the `retention` tag, and no
blob secret in any response. `src/lib/api/artifacts.test.ts` and `src/state/downloadAll.test.ts`
are the client's unit tests.
