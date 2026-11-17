// The S3 blob store against the compose emulator (#46 §2a): `bun run test:integration`.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ORG } from "../db/org";
import { createTestDatabase, type TestDatabase } from "../db/testing";
import { blobConfig } from "./config";
import { collectOrphans, ORPHAN_AGE_MS } from "./gc";
import { artifactKey, type BlobKey, bundleKey, modelKey, orgKeyPrefix } from "./keys";
import { createS3BlobStore } from "./s3";
import { createTestBlobStore, scratchOrg, testBlobConfig } from "./testing";

const store = createTestBlobStore();
const org = scratchOrg();
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const BROWSER_ORIGIN = "http://localhost:3000";

async function keysUnder(prefix: BlobKey): Promise<string[]> {
  const keys: string[] = [];
  for await (const o of store.list(prefix)) keys.push(o.key);
  return keys;
}

afterAll(async () => {
  for (const key of await keysUnder(orgKeyPrefix(org))) await store.delete(key as BlobKey);
});

describe("S3 blob store", () => {
  it("puts, heads, gets, lists and deletes", async () => {
    const body = new TextEncoder().encode("hello crate");
    const key = artifactKey(org, "abc123", "1.0.0", "cutlist.csv");
    await store.put(key, body, { contentType: "text/csv", metadata: { sha256: sha(body) } });

    const info = await store.head(key);
    expect(info).toMatchObject({ key, size: body.byteLength, contentType: "text/csv", metadata: { sha256: sha(body) } });
    expect(info!.lastModified.getTime()).toBeGreaterThan(Date.now() - 60_000);

    const got = await store.get(key);
    expect(new TextDecoder().decode(got!.body)).toBe("hello crate");
    expect(await keysUnder(orgKeyPrefix(org))).toContain(key);

    await store.delete(key);
    expect(await store.head(key)).toBeUndefined();
    expect(await store.get(key)).toBeUndefined();
    await store.delete(key); // Deleting again is not an error.
  });

  it("lists past a page boundary", async () => {
    const keys = Array.from({ length: 3 }, (_, i) => bundleKey(org, `page-${i}`));
    for (const key of keys) await store.put(key, new Uint8Array([1]));
    const listed = await keysUnder(`${orgKeyPrefix(org)}bundles/` as BlobKey);
    expect(listed).toEqual([...keys].sort());
  });

  it("stores the same content-addressed bytes once", async () => {
    const bytes = randomBytes(1024);
    const key = modelKey(org, sha(bytes));
    await store.put(key, bytes);
    await store.put(key, bytes);
    expect(await keysUnder(key)).toEqual([key]);
    expect((await store.head(key))!.size).toBe(1024);
  });

  it("gives presigned GET URLs that work without credentials, then expire", async () => {
    const bytes = randomBytes(64);
    const key = modelKey(org, sha(bytes));
    await store.put(key, bytes, { contentType: "model/gltf-binary" });

    const { url, expiresAt } = await store.presignGet(key, { downloadName: "Bracket.glb" });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(290_000);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect(url).not.toContain(blobConfig().secretAccessKey);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(res.headers.get("content-disposition")).toContain('filename="Bracket.glb"');

    // Anonymous access without a signature is refused.
    const plain = new URL(url);
    plain.search = "";
    expect((await fetch(plain)).status).toBe(403);

    // Expiry, without racing a clock: waiting out a 1 s URL failed under load, when the store's
    // clock (in a VM) lagged this machine's. Both URLs are signed ten minutes ago, far beyond any
    // such skew, and differ only in their lifetime: one still covers now and works (so a
    // signature from the past is accepted), the other ran out nine minutes ago and is refused.
    const tenMinutesAgo = new Date(Date.now() - 600_000);
    const live = await store.presignGet(key, { expiresInSeconds: 900, signedAt: tenMinutesAgo });
    expect(live.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await fetch(live.url)).status).toBe(200);
    const expired = await store.presignGet(key, { expiresInSeconds: 60, signedAt: tenMinutesAgo });
    expect(expired.expiresAt.getTime()).toBeLessThan(Date.now());
    const refused = await fetch(expired.url);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/expired/i);
  });

  it("answers the browser's CORS preflight and GET for a presigned URL", async () => {
    const bytes = randomBytes(32);
    const key = modelKey(org, sha(bytes));
    await store.put(key, bytes);
    const { url } = await store.presignGet(key);

    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: BROWSER_ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers.get("access-control-allow-origin")).toMatch(/^(\*|http:\/\/localhost:3000)$/);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("GET");

    const get = await fetch(url, { headers: { Origin: BROWSER_ORIGIN } });
    expect(get.status).toBe(200);
    expect(get.headers.get("access-control-allow-origin")).toMatch(/^(\*|http:\/\/localhost:3000)$/);
  });

  it("refuses requests signed with the wrong secret", async () => {
    const wrong = createS3BlobStore({ ...testBlobConfig(), secretAccessKey: "not-the-secret" });
    await expect(wrong.put(bundleKey(org, "nope"), new Uint8Array([1]))).rejects.toThrow();
  });
});

describe("orphan cleanup", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase("blobgc");
  });
  afterAll(() => t?.drop());

  it("deletes objects with no metadata row once they are older than 24 h, and keeps the rest", async () => {
    // Under DEFAULT_ORG, so the part_model row can exist; a unique sha keeps it apart from other tests.
    const kept = randomBytes(48);
    const keptKey = modelKey(DEFAULT_ORG, sha(kept));
    const orphan = randomBytes(48);
    const orphanKey = modelKey(DEFAULT_ORG, sha(orphan));
    await store.put(keptKey, kept);
    await store.put(orphanKey, orphan);
    await t.repo.partModels.put(DEFAULT_ORG, { sha256: sha(kept), sizeBytes: 48, objectKey: keptKey });
    // A key this app doesn't write is never touched.
    const foreign = "elsewhere/readme.txt" as BlobKey;
    await store.put(foreign, new Uint8Array([1]));

    const opts = { store, repo: t.repo };
    const onlyOurs = async (prefix: BlobKey, now: Date, dryRun = false) => {
      const result = await collectOrphans({ ...opts, now, dryRun, prefix });
      return result.orphans.filter((k) => k === keptKey || k === orphanKey);
    };

    // Fresh objects are in-flight uploads as far as cleanup knows: kept.
    expect(await onlyOurs(keptKey, new Date())).toEqual([]);
    expect(await onlyOurs(orphanKey, new Date())).toEqual([]);

    const later = new Date(Date.now() + ORPHAN_AGE_MS + 60_000);
    expect(await onlyOurs(orphanKey, later, true)).toEqual([orphanKey]);
    expect(await store.head(orphanKey)).toBeDefined(); // dry run

    expect(await onlyOurs(keptKey, later)).toEqual([]);
    expect(await onlyOurs(orphanKey, later)).toEqual([orphanKey]);
    expect(await store.head(orphanKey)).toBeUndefined();
    expect(await store.head(keptKey)).toBeDefined();

    expect((await collectOrphans({ ...opts, now: later, prefix: "elsewhere/" as BlobKey })).orphans).toEqual([]);
    expect(await store.head(foreign)).toBeDefined();
    await store.delete(foreign);
    await store.delete(keptKey);
  });
});
