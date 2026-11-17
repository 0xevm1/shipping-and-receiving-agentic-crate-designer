# Blob storage

Part GLBs and generated files (crate GLB, PDF, CSV, bundle ZIPs) live in S3-compatible object
storage (#46 §2a), never in Postgres and never on the server's disk. Postgres holds only the
metadata and the object key (`part_model.object_key`, `artifact.object_key`). Locally the store is
the SeaweedFS emulator from `docker-compose.yml` ([POSTGRES.md](POSTGRES.md#blob-emulator)).

**Status (slice 1a):** the `BlobStore` client, object keys, GLB upload through the API, presigned
downloads and orphan cleanup are in. Generated artifacts are written by later slices; their keys
and lifecycle are settled below. Nothing in the UI uses the API yet.

## One API: S3

The app codes against the S3 API only (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`),
with a configurable endpoint and path-style switch, so the same code runs against:

| Provider | `BLOB_ENDPOINT` | `BLOB_FORCE_PATH_STYLE` | Notes |
|---|---|---|---|
| Compose emulator (default) | `http://localhost:9000` | `true` | Credentials `crate-dev` / `crate-dev-secret` |
| AWS S3 | empty (the SDK's regional endpoint) | `false` | IAM user or role keys; set `BLOB_REGION` |
| Cloudflare R2 | `https://<account>.r2.cloudflarestorage.com` | `true` | R2 API token keys; `BLOB_REGION=auto` |
| Google Cloud Storage | `https://storage.googleapis.com` | `true` | HMAC keys on a service account (the XML API) |

Point the `BLOB_*` variables (table in [POSTGRES.md](POSTGRES.md#environment)) at the provider:
no code changes. Create the bucket and apply the CORS rule from `infra/blob-cors.json` there
yourself (restrict `AllowedOrigins` to the app's origin). `BLOB_PUBLIC_ENDPOINT` (optional,
defaults to `BLOB_ENDPOINT`) is the endpoint written into presigned URLs, for when the browser
reaches the store by a different host than the server does.

The client sends the SDK's newer flexible checksums only when an operation requires them
(`requestChecksumCalculation: "WHEN_REQUIRED"`), because R2, GCS and emulators don't all accept
them.

**Credentials never reach the browser.** `BLOB_*` are read only in `src/server/blob/config.ts`
(no `NEXT_PUBLIC_` prefix, so Next.js never inlines them); ESLint bans `@aws-sdk/*` everywhere but
`src/server/`, and only `src/app/` may import `src/server/`; `src/server/blob/index.ts` imports
`server-only`. API errors from the store become a generic 500 (`src/server/http.ts`): no bucket,
endpoint or signature text in responses. The browser gets presigned URLs only; those carry the
access key **id** (as every presigned URL does) but never the secret.

## Code (`src/server/blob/`)

| File | Exports |
|---|---|
| `store.ts` | `BlobStore`: `put`, `get`, `head`, `delete`, `presignGet`, `list` (async iterable over pages); `PRESIGN_SECONDS` (300) |
| `s3.ts` | `createS3BlobStore(config)`: the S3 implementation |
| `config.ts` | `blobConfig(env)`: the `BLOB_*` variables with emulator defaults |
| `keys.ts` | `modelKey`, `artifactKey`, `bundleKey`, `orgKeyPrefix` (all take an `OrgContext`), `orgOfKey`, the `BlobKey` brand |
| `gc.ts` | `collectOrphans({ store, repo, olderThanMs, dryRun, prefix })`, `ORPHAN_AGE_MS` |
| `index.ts` | `getBlobStore()` (created from the env on first use), `resetBlobStore()` |
| `testing.ts` | Integration-test helpers: the store on `crate-designer-test`, `scratchOrg()` |

A native client (the GCS JSON API, say) would be a second `BlobStore` implementation; nothing
outside `s3.ts` imports the SDK.

## Object keys

Every key starts with `org/<orgId>/`, and the only way to build one is a function in `keys.ts`
that takes an `OrgContext`. The store's methods take a `BlobKey` (branded), so a raw string or a
bare hash can't be stored or fetched by mistake.

| Object | Key |
|---|---|
| Part GLB | `org/<orgId>/models/<sha256>.glb` |
| Generated file | `org/<orgId>/artifacts/<inputHash>/<engineVersion>/{crate.glb,spec.pdf,cutlist.csv}` |
| Bundle | `org/<orgId>/bundles/<id>.zip` |

Keys are content-addressed (sha256 or the engine's `inputHash`), so the same bytes are stored once
per org. They are per org, never global, and nothing is looked up by hash alone: the API finds a
model through its part, inside the caller's org.

## Uploading a part: `POST /api/v1/parts`

GLBs come through the API, not straight to the bucket, so validation happens in one place and
says what the app says. Multipart form fields (schemas in `src/lib/api/parts.ts`):

| Field | |
|---|---|
| `file` | The part's binary `.glb`, at most 50 MB (`MAX_GLB_BYTES`) |
| `mass` | kg per part, required: `12.5` or `12.5 kg` (spec §6.1: never inferred from the mesh). Pounds are refused |
| `material` | Optional text |
| `density` | Optional, kg/m³ |
| `name` | Optional; defaults to one made from the file name, as the app does |

Checks, with the same messages as the browser (`GLB_MESSAGES` in `src/domain/glb.ts`, which
`src/lib/loadPart.ts` uses too):

| Refused | Status | Code |
|---|---|---|
| Missing or bad `mass`, bad `density`, missing `file` | 400 | `invalid_request` (with `field`) |
| Not multipart | 415 | `invalid_request` |
| Over 50 MB (by `Content-Length` before reading, then by the file) | 413 | `too_large` |
| Text `.gltf` (by name or content), non-GLB data | 415 | `unsupported_file` |
| Damaged header or chunks, Draco / Meshopt (`extensionsRequired`), no geometry | 422 | `invalid_glb` |

The server measures the model's bounding box from the JSON chunk (`glbSizeUnits`: each POSITION
accessor's min / max through the node transforms, the same box three.js gives; a unit test
compares them on every bundled part), and reads a part over 20 units across as millimetres, as
the browser does.

Then, in this order:

1. sha256 of the bytes; key `org/<orgId>/models/<sha256>.glb`.
2. **The object first.** `head`; `put` only if it is missing, a different size, or older than
   12 h (half the orphan age, so cleanup can't delete it between this check and step 3).
3. **Then the rows**, in one transaction: `part_model` (content-addressed: the same file again
   finds the existing row, `model.created: false`) and a new `part`. A crash between 2 and 3
   leaves an orphan object, never a row with nothing behind it.

`201` with `{ part, model: { sha256, sizeBytes, readAsMm, created } }` and a `Location` header.
Every upload is its own `part` (the mass or name may differ); the bytes are stored once.

The `part.created` event will be appended in that transaction once the event slice lands (a
`TODO(#46 events)` marks the spot in `src/server/parts/create.ts`). Until there is auth, every
request runs as `DEFAULT_ORG`.

## Downloading: `GET /api/v1/parts/:id/model`

Returns `{ url, expiresAt, sha256, sizeBytes }` with a presigned GET URL that lasts 5 minutes,
or a `302` to it with `?redirect=1`. The bytes go straight from the store to the browser and skip
Next.js. The part is looked up by id within the caller's org: an unknown id, a malformed one and
another org's part are all the same `404`. Responses are `Cache-Control: private, no-store`.
The bucket's CORS rule (`infra/blob-cors.json`) lets the browser `GET` / `HEAD` the URL.

## Orphan cleanup: `bun run blob:gc`

Deletes objects under `org/<orgId>/` that no `part_model` or `artifact` row names and that are
older than 24 h (`ORPHAN_AGE_MS`), which leaves in-flight uploads alone. Each batch of keys is
checked through the org-scoped repository (`blobRefs.referenced`) with that key's org, so even
maintenance never queries without an `OrgContext`. Keys outside `org/` are never touched.

```bash
bun run blob:gc -- --dry-run              # list what would go
bun run blob:gc                           # delete orphans older than 24 h
bun run blob:gc -- --older-than-hours=48  # at least 1
```

Run it daily (cron, a scheduled CI job, or the job queue once it exists). Bundles must have an
`artifact` row (kind `zip`) naming their key, or cleanup will treat them as orphans.

## Lifecycle of generated files

Part models are kept. Generated artifacts can be rebuilt from their configuration, so they should
expire after N days (30 suggested) unless they belong to an approved batch (#60). The plan, for
when artifacts are written:

- Write artifacts with the object tag `retention=ephemeral`.
- One bucket lifecycle rule: `Filter: { Tag: { Key: "retention", Value: "ephemeral" } }`,
  `Expiration: { Days: N }`. A prefix filter can't do it, because the org id comes before
  `artifacts/` in the key.
- Approving a batch removes the tag (`PutObjectTagging` with no `retention` tag) on its
  artifacts, so they are kept. The artifact's row stays; a missing object is rebuilt on the next
  request ("built and cached on first request"), so expiry never breaks a link.

**Not applied yet.** SeaweedFS 4.51 accepts and returns a tag-filtered lifecycle configuration
(checked), but whether it enforces tag filters (its expiry is TTL-based) wasn't verified, and no
artifacts are written yet. Apply the rule in `infra/blob-init.sh` and on the real bucket in the
slice that writes artifacts, with a test that checks the tag.

## Emulator quirks

- SeaweedFS creates a bucket on the first write to it; AWS S3 answers `NoSuchBucket`. Don't rely
  on either: `blob-init` creates the buckets.
- Anonymous requests get 403, presigned URLs are enforced (including expiry), and CORS
  preflights are answered from the bucket rule, as on S3. The integration tests check each.

## Tests

`src/server/blob/s3.integration.test.ts` and `src/app/api/v1/parts/parts.integration.test.ts`
run with `bun run test:integration` against the emulator's `crate-designer-test` bucket (each
file uses its own org prefix or a scratch database, so parallel files don't collide): put / get /
head / list / delete, content-addressed puts, presigned GETs that work and then expire,
anonymous access refused, the CORS preflight from a browser origin, orphan cleanup, the upload
route end to end (one object and one `part_model` row for the same file twice), the Draco,
Meshopt, text `.gltf`, non-GLB, too-large and missing-mass rejections, the model URL route and
its org check, and that no response carries the secret key or store details.
