// POST /api/v1/parts and GET /api/v1/parts/:id/model end to end (#46): the Route Handlers
// themselves, called with a Request, against a scratch Postgres database and the emulator's test
// bucket. `bun run test:integration`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GLB_MESSAGES, MAX_GLB_BYTES } from "@/domain/glb";
import { ApiErrorSchema, CreatePartResponseSchema, ModelUrlResponseSchema } from "@/lib/api/parts";
import { blobConfig } from "@/server/blob/config";
import { resetBlobStore } from "@/server/blob";
import { modelKey } from "@/server/blob/keys";
import { createTestBlobStore, TEST_BUCKET } from "@/server/blob/testing";
import { closeDb, DEFAULT_ORG, orgContext } from "@/server/db";
import { org } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { POST } from "./route";
import { GET } from "./[id]/model/route";

const SAMPLE = "PART-001-machined-steel-bracket.glb";
const sampleBytes = new Uint8Array(readFileSync(`public/parts/${SAMPLE}`));
const store = createTestBlobStore();
const { secretAccessKey, accessKeyId } = blobConfig();

let t: TestDatabase;
const saved = { DATABASE_URL: process.env.DATABASE_URL, BLOB_BUCKET: process.env.BLOB_BUCKET };

beforeAll(async () => {
  t = await createTestDatabase("parts_api");
  // The route handlers build their pool and store from the environment on first use.
  process.env.DATABASE_URL = t.url;
  process.env.BLOB_BUCKET = TEST_BUCKET;
  resetBlobStore();
});
afterAll(async () => {
  await closeDb();
  resetBlobStore();
  Object.assign(process.env, saved);
  await t?.drop();
});

function upload(fields: Record<string, string>, file?: { bytes: Uint8Array; name: string }): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", new File([file.bytes as Uint8Array<ArrayBuffer>], file.name));
  return new Request("http://localhost/api/v1/parts", { method: "POST", body: form });
}

const modelUrl = (id: string, query = "") => GET(new Request(`http://localhost/api/v1/parts/${id}/model${query}`), { params: Promise.resolve({ id }) });

/** The response body as text, checked to carry no blob-store secrets, then parsed. */
async function body(res: Response): Promise<unknown> {
  const text = await res.text();
  expect(text).not.toContain(secretAccessKey);
  return JSON.parse(text);
}

async function expectError(res: Response, status: number, message: string, field?: string) {
  expect(res.status).toBe(status);
  const parsed = ApiErrorSchema.parse(await body(res));
  expect(parsed.error.message).toBe(message);
  if (field) expect(parsed.error.field).toBe(field);
}

/** A GLB with just a JSON chunk. */
function fakeGlb(json: object): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(20 + padded).fill(0x20, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  return bytes;
}

describe("POST /api/v1/parts", () => {
  it("stores the GLB once and the part per upload", async () => {
    const first = await POST(upload({ mass: "21.5", material: "4140 steel", density: "7850" }, { bytes: sampleBytes, name: SAMPLE }));
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toContain("no-store");
    const a = CreatePartResponseSchema.parse(await body(first));
    expect(a.part).toMatchObject({ name: "Machined steel bracket", material: "4140 steel", densityKgM3: 7850, massKg: 21.5, source: "upload" });
    expect(a.model.created).toBe(true);
    expect(a.model.readAsMm).toBe(false);
    expect(first.headers.get("location")).toBe(`/api/v1/parts/${a.part.id}`);
    // The size comes from the file, as the browser measures it (PART-001 is about 300 × 200 × 150 mm).
    a.part.sizeMm.forEach((v) => expect(v).toBeGreaterThan(50));
    // Its org-wide part.created event committed with it.
    const created = await t.sql`select job_id, payload from event where type = 'part.created'`;
    expect(created.map((r) => r.payload.partId)).toContain(a.part.id);

    const second = await POST(upload({ mass: "22 kg", name: "Bracket rev B" }, { bytes: sampleBytes, name: "copy.glb" }));
    expect(second.status).toBe(201);
    const b = CreatePartResponseSchema.parse(await body(second));
    expect(b.model).toEqual({ ...a.model, created: false });
    expect(b.part.id).not.toBe(a.part.id);
    expect(b.part).toMatchObject({ name: "Bracket rev B", massKg: 22, material: null, modelSha256: a.model.sha256 });

    // One object, one part_model row, two parts.
    const key = modelKey(DEFAULT_ORG, a.model.sha256);
    const objects: string[] = [];
    for await (const o of store.list(key)) objects.push(o.key);
    expect(objects).toEqual([key]);
    expect((await store.head(key))!.size).toBe(sampleBytes.byteLength);
    expect(await t.sql`select count(*)::int as n from part_model`).toEqual([{ n: 1 }]);
    expect(await t.sql`select count(*)::int as n from part`).toEqual([{ n: 2 }]);
  });

  it("refuses a missing or bad mass with the app's words", async () => {
    await expectError(await POST(upload({}, { bytes: sampleBytes, name: SAMPLE })), 400, "Enter the mass of one part in kg.", "mass");
    await expectError(await POST(upload({ mass: "-1" }, { bytes: sampleBytes, name: SAMPLE })), 400, "Enter a number of kg, like 12.5.", "mass");
  });

  it("refuses Draco and Meshopt, text .gltf, non-GLB data and a missing file", async () => {
    const draco = fakeGlb({ asset: { version: "2.0" }, extensionsRequired: ["KHR_draco_mesh_compression"] });
    await expectError(await POST(upload({ mass: "1" }, { bytes: draco, name: "d.glb" })), 422, GLB_MESSAGES.compressed, "file");
    const meshopt = fakeGlb({ asset: { version: "2.0" }, extensionsRequired: ["EXT_meshopt_compression"] });
    await expectError(await POST(upload({ mass: "1" }, { bytes: meshopt, name: "m.glb" })), 422, GLB_MESSAGES.compressed, "file");

    const gltf = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
    await expectError(await POST(upload({ mass: "1" }, { bytes: gltf, name: "part.gltf" })), 415, GLB_MESSAGES.textGltf, "file");
    await expectError(await POST(upload({ mass: "1" }, { bytes: gltf, name: "renamed.glb" })), 415, GLB_MESSAGES.textGltf, "file");

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(40).fill(0)]);
    await expectError(await POST(upload({ mass: "1" }, { bytes: png, name: "x.glb" })), 415, GLB_MESSAGES.notGlb, "file");
    await expectError(await POST(upload({ mass: "1" }, { bytes: fakeGlb({ asset: {} }), name: "empty.glb" })), 422, GLB_MESSAGES.noGeometry);
    await expectError(await POST(upload({ mass: "1" })), 400, "Add the part's .glb file, in a field named file.", "file");

    // Nothing was stored for any of them.
    expect(await t.sql`select count(*)::int as n from part_model`).toEqual([{ n: 1 }]);
  });

  it("refuses a file over the size limit", async () => {
    const big = new Uint8Array(MAX_GLB_BYTES + 1);
    big.set(sampleBytes);
    await expectError(await POST(upload({ mass: "1" }, { bytes: big, name: "big.glb" })), 413, GLB_MESSAGES.tooLarge, "file");
  });

  it("refuses a body that isn't multipart", async () => {
    const res = await POST(new Request("http://localhost/api/v1/parts", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(415);
  });

  it("hides store errors behind a generic 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = process.env.BLOB_SECRET_ACCESS_KEY;
    process.env.BLOB_SECRET_ACCESS_KEY = "wrong-secret-for-crate-tests";
    resetBlobStore();
    try {
      const res = await POST(upload({ mass: "1" }, { bytes: sampleBytes, name: SAMPLE }));
      expect(res.status).toBe(500);
      const text = JSON.stringify(await body(res));
      for (const leak of ["wrong-secret", "Signature", TEST_BUCKET, accessKeyId, blobConfig().endpoint!]) expect(text).not.toContain(leak);
      expect(log).toHaveBeenCalled();
    } finally {
      if (secret === undefined) delete process.env.BLOB_SECRET_ACCESS_KEY;
      else process.env.BLOB_SECRET_ACCESS_KEY = secret;
      resetBlobStore();
      log.mockRestore();
    }
  });
});

describe("GET /api/v1/parts/:id/model", () => {
  it("gives a short-lived presigned URL for the part's GLB, or a redirect to it", async () => {
    const created = CreatePartResponseSchema.parse(await body(await POST(upload({ mass: "3" }, { bytes: sampleBytes, name: SAMPLE }))));
    const res = await modelUrl(created.part.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const model = ModelUrlResponseSchema.parse(await body(res));
    expect(model.sha256).toBe(created.model.sha256);
    const lifetime = Date.parse(model.expiresAt) - Date.now();
    expect(lifetime).toBeGreaterThan(240_000);
    expect(lifetime).toBeLessThanOrEqual(300_000);

    const download = await fetch(model.url);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(sampleBytes);

    const redirect = await modelUrl(created.part.id, "?redirect=1");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toMatch(/X-Amz-Signature=/);
  });

  it("is 404 for an unknown id, a malformed id and another org's part", async () => {
    await expectError(await modelUrl("00000000-0000-4000-8000-00000000abcd"), 404, "There is no model for that part.");
    await expectError(await modelUrl("not-a-uuid"), 404, "There is no model for that part.");

    const [row] = await t.db.insert(org).values({ slug: "other", name: "Other" }).returning();
    const other = orgContext(row!.id);
    const sha = "b".repeat(64);
    await t.repo.partModels.put(other, { sha256: sha, sizeBytes: 10, objectKey: modelKey(other, sha) });
    const theirs = await t.repo.parts.create(other, {
      name: "Theirs",
      massKg: 1,
      sizeXMm: 1,
      sizeYMm: 1,
      sizeZMm: 1,
      modelSha256: sha,
      source: "upload",
    });
    await expectError(await modelUrl(theirs.id), 404, "There is no model for that part.");
  });
});
