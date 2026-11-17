// Server-built artifacts end to end (#46 slice 6, docs/API.md "Artifacts"): the Route Handlers for
// a configuration's files and the job's bundle.zip, against a scratch Postgres database, the blob
// emulator's test bucket and the engine's worker threads. `bun run test:integration`.
import { GetObjectTaggingCommand, S3Client } from "@aws-sdk/client-s3";
import { unzipSync } from "fflate";
import { Box3, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import type { BundleManifest } from "@/engine/artifacts";
import { designShipment } from "@/engine/engine";
import { parseGlb } from "@/engine/glb";
import type { DesignRequest } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import { ArtifactUrlResponseSchema, BundleResponseSchema } from "@/lib/api/artifacts";
import { CreateJobResponseSchema, JobSnapshotSchema, SaveConfigurationResponseSchema } from "@/lib/api/jobs";
import { ApiErrorSchema } from "@/lib/api/parts";
import { CRATE_NODE, PARTS_NODE } from "@/lib/exportGlb";
import { createBundleHandler, jobBundle } from "@/server/artifacts/service";
import { storeOnce } from "@/server/artifacts/store";
import { resetBlobStore } from "@/server/blob";
import { blobConfig } from "@/server/blob/config";
import { collectOrphans } from "@/server/blob/gc";
import { artifactKey, type BlobKey, bundleKey, orgKeyPrefix } from "@/server/blob/keys";
import { createTestBlobStore, testBlobConfig } from "@/server/blob/testing";
import { closeDb, DEFAULT_ORG, orgContext } from "@/server/db";
import { createQueueStore } from "@/server/db/queue";
import { org } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { peekEventBus } from "@/server/events";
import { createJobHandlers } from "@/server/queue/jobs";
import { createQueueRunner } from "@/server/queue/runner";
import { closeEnginePool, getEnginePool } from "@/server/workers/engine";
import { GET as bundleGET } from "./[id]/bundle.zip/route";
import { POST as saveConfig } from "./[id]/configs/route";
import { GET as fileGET } from "./[id]/configs/[cid]/[file]/route";
import { GET as snapshotGET } from "./[id]/route";
import { POST as createJob } from "./route";

const BASE = "http://localhost/api/v1";
const PART = catalog.parts[0]!;
const store = createTestBlobStore();
const { secretAccessKey } = blobConfig();
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

let t: TestDatabase;
const saved = { DATABASE_URL: process.env.DATABASE_URL, BLOB_BUCKET: process.env.BLOB_BUCKET };

beforeAll(async () => {
  t = await createTestDatabase("artifacts_api");
  process.env.DATABASE_URL = t.url;
  process.env.BLOB_BUCKET = testBlobConfig().bucket;
  resetBlobStore();
});
afterAll(async () => {
  await peekEventBus()?.stop();
  (globalThis as { __crateDesignerEventBus?: unknown }).__crateDesignerEventBus = undefined;
  await closeEnginePool();
  await closeDb();
  resetBlobStore();
  Object.assign(process.env, saved);
  await t?.drop();
});

const json = (method: string, path: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

/** A response body as text, checked to carry no blob-store secret, then parsed. */
async function body(res: Response): Promise<unknown> {
  const text = await res.text();
  expect(text).not.toContain(secretAccessKey);
  return JSON.parse(text);
}

async function newJob(): Promise<string> {
  const res = await createJob(json("POST", "/jobs", { catalogId: PART.id }));
  expect(res.status).toBe(201);
  return CreateJobResponseSchema.parse(await res.json()).job.id;
}

function request(quantity: number): DesignRequest {
  return {
    part: { id: PART.id, name: PART.name, mass_kg: PART.mass_kg, dimensions_mm: PART.dimensions_mm, material: PART.material },
    settings: { ...DEFAULT_SETTINGS, quantity },
    standards: DEFAULT_STANDARDS,
    layoutKey: null,
    ranking: "volume",
  };
}

async function saveQuantity(jobId: string, quantity: number): Promise<{ id: string; inputHash: string }> {
  const req = request(quantity);
  const out = designShipment(req);
  const b = JSON.parse(JSON.stringify({ request: req, engineVersion: out.engineVersion, inputHash: out.inputHash, summary: out.summary }));
  const res = await saveConfig(json("POST", `/jobs/${jobId}/configs`, b), { params: Promise.resolve({ id: jobId }) });
  expect(res.status).toBe(201);
  return SaveConfigurationResponseSchema.parse(await res.json()).configuration;
}

const getFile = (jobId: string, cid: string, file: string, query = "") =>
  fileGET(new Request(`${BASE}/jobs/${jobId}/configs/${cid}/${file}${query}`), { params: Promise.resolve({ id: jobId, cid, file }) });
const getBundle = (jobId: string, query = "") => bundleGET(new Request(`${BASE}/jobs/${jobId}/bundle.zip${query}`), { params: Promise.resolve({ id: jobId }) });

async function artifactRows(key: string) {
  return t.sql<{ id: string; sha256: string; built_by: string; kind: string }[]>`select id, sha256, built_by, kind from artifact where object_key = ${key}`;
}
async function readyEvents(jobId: string) {
  return (await t.repo.events.listAfter(DEFAULT_ORG, jobId)).filter((e) => e.type === "artifact.ready");
}
async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}
async function expect404(res: Response) {
  expect(res.status).toBe(404);
  expect(ApiErrorSchema.parse(await body(res)).error.code).toBe("not_found");
}

describe("GET /jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}", () => {
  let jobId: string;
  let config: { id: string; inputHash: string };

  beforeAll(async () => {
    jobId = await newJob();
    config = await saveQuantity(jobId, 4);
  });

  it("builds on the first request, then serves the stored file: one object, one row, one artifact.ready", async () => {
    const first = await getFile(jobId, config.id, "cutlist.csv");
    expect(first.status).toBe(200);
    const a = ArtifactUrlResponseSchema.parse(await body(first));
    expect(a).toMatchObject({
      kind: "csv",
      builtBy: "server",
      cached: false,
      engineVersion: ENGINE_VERSION,
      inputHash: config.inputHash,
      contentType: "text/csv; charset=utf-8",
    });
    expect(a.fileName).toBe("crate-PART-001-x4.csv");

    const csv = new TextDecoder().decode(await download(a.url));
    expect(csv).toContain(`# Engine ${ENGINE_VERSION}, input ${config.inputHash}`);

    const again = ArtifactUrlResponseSchema.parse(await body(await getFile(jobId, config.id, "cutlist.csv")));
    expect(again).toMatchObject({ artifactId: a.artifactId, sha256: a.sha256, cached: true, fileName: a.fileName });

    const key = artifactKey(DEFAULT_ORG, config.inputHash, ENGINE_VERSION, "cutlist.csv");
    expect(await artifactRows(key)).toEqual([{ id: a.artifactId, sha256: a.sha256, built_by: "server", kind: "csv" }]);
    const objects = [];
    for await (const o of store.list(key)) objects.push(o);
    expect(objects).toHaveLength(1);
    expect((await readyEvents(jobId)).filter((e) => e.payload.kind === "csv")).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ artifactId: a.artifactId, configurationId: config.id, kind: "csv", file: "cutlist.csv" }) }),
    ]);

    // The snapshot lists it; the object is tagged so a lifecycle rule may expire it (it is rebuilt then).
    const snap = JobSnapshotSchema.parse(await (await snapshotGET(new Request(`${BASE}/jobs/${jobId}`), { params: Promise.resolve({ id: jobId }) })).json());
    expect(snap.artifacts).toContainEqual(expect.objectContaining({ id: a.artifactId, kind: "csv", builtBy: "server" }));
    const cfg = testBlobConfig();
    const s3 = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    const tags = await s3.send(new GetObjectTaggingCommand({ Bucket: cfg.bucket, Key: key }));
    expect(tags.TagSet).toContainEqual({ Key: "retention", Value: "ephemeral" });
  });

  it("concurrent first requests build once", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => getFile(jobId, config.id, "spec.pdf")));
    const parsed = await Promise.all(results.map(async (r) => ArtifactUrlResponseSchema.parse(await body(r))));
    expect(new Set(parsed.map((p) => p.artifactId)).size).toBe(1);
    expect(new Set(parsed.map((p) => p.sha256)).size).toBe(1);
    expect(parsed.filter((p) => !p.cached).length).toBeGreaterThanOrEqual(1);
    const key = artifactKey(DEFAULT_ORG, config.inputHash, ENGINE_VERSION, "spec.pdf");
    expect(await artifactRows(key)).toHaveLength(1);
    expect((await readyEvents(jobId)).filter((e) => e.payload.kind === "pdf")).toHaveLength(1);
    const pdf = await download(parsed[0]!.url);
    expect(new TextDecoder("latin1").decode(pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("without the in-process single flight, the database lock alone keeps it to one build", async () => {
    const key = `${orgKeyPrefix(DEFAULT_ORG)}artifacts/lock-test/${Date.now()}/crate.glb` as BlobKey;
    let builds = 0;
    const deps = { db: t.db, blob: store, org: DEFAULT_ORG };
    const input = {
      key,
      kind: "glb" as const,
      configurationId: config.id,
      jobId,
      build: async () => {
        builds++;
        await new Promise((r) => setTimeout(r, 150));
        const bytes = new TextEncoder().encode("same bytes every time");
        return { bytes, sha256: "0".repeat(64), fileName: "x.glb", contentType: "model/gltf-binary" };
      },
    };
    const out = await Promise.all(Array.from({ length: 4 }, () => storeOnce(deps, input, { shareInProcess: false })));
    expect(builds).toBe(1);
    expect(new Set(out.map((o) => o.row.id)).size).toBe(1);
    expect(out.filter((o) => !o.cached)).toHaveLength(1);
    expect(await artifactRows(key)).toHaveLength(1);
  });

  it("the crate GLB uses the part model from blob storage, reloads, and is the crate's outside size within 1 mm", async () => {
    const res = await getFile(jobId, config.id, "crate.glb", "?redirect=1");
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/X-Amz-Signature=/);
    expect(location).not.toContain(secretAccessKey);
    const bytes = await download(location);
    const scene = await parseGlb(bytes.slice().buffer as ArrayBuffer);
    const { inputHash, plan } = designShipment(request(4));
    expect(scene.userData).toMatchObject({ engineVersion: ENGINE_VERSION, inputHash });
    const design = plan.crates[0]!.result.design!;
    expect(scene.getObjectByName(PARTS_NODE)?.children).toHaveLength(design.layout.slots.length);
    const size = new Box3().setFromObject(scene.getObjectByName(CRATE_NODE)!).getSize(new Vector3());
    const [x, y, z] = design.layout.external;
    expect(Math.abs(size.x * 1000 - x)).toBeLessThan(1);
    expect(Math.abs(size.y * 1000 - y)).toBeLessThan(1);
    expect(Math.abs(size.z * 1000 - z)).toBeLessThan(1);
    // The catalog part's model was stored in blob storage as a part_model of the org.
    const models = await t.sql<{ object_key: string }[]>`select object_key from part_model where org_id = ${DEFAULT_ORG.orgId}`;
    expect(models.map((m) => m.object_key)).toEqual([expect.stringMatching(new RegExp(`^${orgKeyPrefix(DEFAULT_ORG)}models/[0-9a-f]{64}\\.glb$`))]);
  });

  it("answers 404 for another org's job, a configuration of another job, a malformed id and an unknown file", async () => {
    const other = orgContext("00000000-0000-4000-8000-0000000000aa");
    await t.db.insert(org).values({ id: other.orgId, slug: "artifacts-other", name: "Other" }).onConflictDoNothing();
    const part = await t.repo.parts.create(other, { name: "x", massKg: 1, sizeXMm: 100, sizeYMm: 100, sizeZMm: 100, source: "upload" });
    const foreign = await t.repo.jobs.create(other, { partId: part.id, totalQuantity: null });
    await expect404(await getFile(foreign.id, config.id, "spec.pdf"));

    const secondJob = await newJob();
    const otherConfig = await saveQuantity(secondJob, 8);
    await expect404(await getFile(jobId, otherConfig.id, "spec.pdf"));
    await expect404(await getFile("not-a-uuid", config.id, "spec.pdf"));
    await expect404(await getFile(jobId, "not-a-uuid", "spec.pdf"));
    await expect404(await getFile(jobId, config.id, "secrets.txt"));
    await expect404(await getBundle(foreign.id));
  });
});

describe("GET /jobs/:id/bundle.zip", () => {
  let jobId: string;
  let configs: { id: string; inputHash: string }[];

  beforeAll(async () => {
    jobId = await newJob();
    configs = [await saveQuantity(jobId, 2), await saveQuantity(jobId, 4), await saveQuantity(jobId, 6)];
  });

  it("builds a ZIP with a folder per configuration, manifest.json and comparison.pdf; then serves it from storage", async () => {
    const res = await getBundle(jobId);
    expect(res.status).toBe(200);
    const b = BundleResponseSchema.parse(await body(res));
    if (b.status !== "ready") throw new Error("expected a ready bundle");
    expect(b).toMatchObject({ kind: "zip", builtBy: "server", cached: false, configurationIds: configs.map((c) => c.id) });

    const files = unzipSync(await download(b.url));
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]!)) as BundleManifest;
    expect(manifest.configurations.map((c) => c.inputHash)).toEqual(configs.map((c) => c.inputHash));
    expect(manifest.bundleHash).toBe(b.inputHash);
    expect(files["comparison.pdf"]).toBeDefined();
    const folders = new Set(
      Object.keys(files)
        .filter((p) => p.includes("/"))
        .map((p) => p.split("/")[0]),
    );
    expect([...folders].sort()).toEqual(manifest.configurations.map((c) => c.folder).sort());
    expect(folders.size).toBe(3);
    for (const c of manifest.configurations) for (const f of c.files) expect(files[f.path]?.length).toBe(f.bytes);

    const again = BundleResponseSchema.parse(await body(await getBundle(jobId, `?configs=${configs.map((c) => c.id).join(",")}`)));
    expect(again).toMatchObject({ status: "ready", cached: true, artifactId: b.artifactId });
    const redirect = await getBundle(jobId, "?redirect=1");
    expect(redirect.status).toBe(302);

    expect((await readyEvents(jobId)).filter((e) => e.payload.kind === "zip")).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ artifactId: b.artifactId, kind: "zip", bundleId: b.bundleId }) }),
    ]);
    expect(await artifactRows(bundleKey(DEFAULT_ORG, b.bundleId))).toHaveLength(1);
  });

  it("orphan cleanup keeps bundle and artifact objects (their rows name them)", async () => {
    const r = await collectOrphans({ store, repo: t.repo, olderThanMs: 0, dryRun: true, prefix: orgKeyPrefix(DEFAULT_ORG) });
    const rows = await t.sql<{ object_key: string }[]>`select object_key from artifact union select object_key from part_model`;
    expect(rows.length).toBeGreaterThan(0);
    for (const { object_key } of rows) expect(r.orphans).not.toContain(object_key);
    expect(rows.some((row) => row.object_key.includes("/bundles/"))).toBe(true);
  });

  it("a larger bundle is queued (202), built by the queue's bundle job, then served", async () => {
    const pick = [configs[2]!.id, configs[0]!.id];
    const deps = { db: t.db, blob: store, org: DEFAULT_ORG, pool: getEnginePool };
    const queued = await jobBundle(jobId, pick, deps, { syncMax: 1 });
    expect(queued.status).toBe(202);
    const q = BundleResponseSchema.parse(queued.body);
    if (q.status !== "queued") throw new Error("expected a queued bundle");
    // Asking again while it waits is the same queue job.
    const twice = BundleResponseSchema.parse((await jobBundle(jobId, pick, deps, { syncMax: 1 })).body);
    expect(twice).toMatchObject({ status: "queued", queueJobId: q.queueJobId });

    const runner = createQueueRunner({
      store: createQueueStore(t.db),
      handlers: createJobHandlers({ db: t.db, pool: getEnginePool(), bundle: createBundleHandler({ db: t.db, blob: store, pool: getEnginePool }) }),
      log: quiet,
    });
    while (await runner.runOnce()) {
      // Drains the queue: the job's sweep (from POST /jobs) and the bundle.
    }
    const job = await createQueueStore(t.db).get(DEFAULT_ORG, q.queueJobId);
    expect(job).toMatchObject({ status: "done", result: expect.objectContaining({ bundleId: q.bundleId, cached: false }) });

    const ready = BundleResponseSchema.parse((await jobBundle(jobId, pick, deps, { syncMax: 1 })).body);
    expect(ready).toMatchObject({ status: "ready", cached: true, bundleId: q.bundleId, configurationIds: pick });
    if (ready.status !== "ready") return;
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(await download(ready.url))["manifest.json"]!)) as BundleManifest;
    expect(manifest.configurations.map((c) => c.inputHash)).toEqual([configs[2]!.inputHash, configs[0]!.inputHash]);
    expect((await readyEvents(jobId)).some((e) => e.payload.bundleId === q.bundleId)).toBe(true);
  });

  it("refuses unknown configurations (404) and a job with nothing saved (422)", async () => {
    await expect404(await getBundle(jobId, "?configs=00000000-0000-4000-8000-00000000dead"));
    const empty = await t.repo.jobs.create(DEFAULT_ORG, { partId: (await t.repo.parts.list(DEFAULT_ORG))[0]!.id, totalQuantity: null });
    const res = await getBundle(empty.id);
    expect(res.status).toBe(422);
  });
});
