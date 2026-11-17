// POST /api/v1/designs end to end (#46 slice 7): the Route Handler, called with a Request, against
// a scratch database (for API keys) and the engine worker pool. `bun run test:integration`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { GLB_MESSAGES } from "@/domain/glb";
import { DesignsApiResponseSchema } from "@/lib/api/designs";
import { ApiErrorSchema } from "@/lib/api/parts";
import { createApiKeyStore } from "@/server/db/apiKeys";
import { closeDb, DEFAULT_ORG } from "@/server/db";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { closeEnginePool } from "@/server/workers/engine";
import { POST as createPart } from "../parts/route";
import { POST } from "./route";

const SAMPLE = getPart("PART-001").model;
const sampleBytes = new Uint8Array(readFileSync(`public/parts/${SAMPLE}`));

let t: TestDatabase;
let key: string;
let revoked: string;
const saved = { DATABASE_URL: process.env.DATABASE_URL };

beforeAll(async () => {
  t = await createTestDatabase("designs_api");
  process.env.DATABASE_URL = t.url;
  const keys = createApiKeyStore(t.db);
  key = (await keys.create(DEFAULT_ORG, "cli")).key;
  const old = await keys.create(DEFAULT_ORG, "old");
  revoked = old.key;
  await keys.revoke(DEFAULT_ORG, old.row.id);
});
afterAll(async () => {
  await closeEnginePool();
  await closeDb();
  Object.assign(process.env, saved);
  await t?.drop();
});

function call(
  fields: Record<string, string>,
  opts: { file?: { bytes: Uint8Array; name: string } | null; headers?: Record<string, string>; path?: string } = {},
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const file = opts.file === undefined ? { bytes: sampleBytes, name: SAMPLE } : opts.file;
  if (file) form.set("file", new File([file.bytes as Uint8Array<ArrayBuffer>], file.name));
  return new Request(`http://localhost${opts.path ?? "/api/v1/designs"}`, { method: "POST", body: form, headers: opts.headers });
}
const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });

async function expectError(res: Response, status: number, message?: string) {
  expect(res.status).toBe(status);
  const body = ApiErrorSchema.parse(await res.json());
  if (message) expect(body.error.message).toBe(message);
  return body;
}

describe("POST /api/v1/designs", () => {
  it("with an API key: ranked configurations, recommendation and total plan, nothing saved", async () => {
    const res = await POST(
      call({ mass: "21.5", total: "40", freightRates: '{"usdPerCwtByClass":{"70":41.5,"85":48},"minimumUsd":95}' }, { headers: bearer(key) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = DesignsApiResponseSchema.parse(await res.json());
    expect(body.basis).toBe("crate-and-freight");
    expect(body.recommendation!.quantityPerCrate).toBe(body.configurations[0]!.quantityPerCrate);
    expect(body.total).toMatchObject({ total: 40 });
    expect(body.part.massKg).toBe(21.5);
    expect(body.model.sizeBytes).toBe(sampleBytes.byteLength);
    // Stateless: no part, job or configuration rows.
    const [{ n }] = await t.sql<
      { n: number }[]
    >`select (select count(*) from part) + (select count(*) from configuration) + (select count(*) from queue_job) as n`;
    expect(Number(n)).toBe(0);
    // The key was used.
    const used = (await createApiKeyStore(t.db).list(DEFAULT_ORG)).find((k) => k.name === "cli");
    expect(used!.lastUsedAt).not.toBeNull();
  });

  it("from the app's own pages, without a key", async () => {
    const res = await POST(call({ mass: "21.5" }, { headers: { "Sec-Fetch-Site": "same-origin" } }));
    expect(res.status).toBe(200);
    expect(DesignsApiResponseSchema.parse(await res.json()).basis).toBe("crate-only");
  });

  it("refuses a script without a key, and a revoked or unknown key", async () => {
    await expectError(await POST(call({ mass: "21.5" })), 401);
    await expectError(await POST(call({ mass: "21.5" }, { headers: bearer(revoked) })), 401, "That API key isn't valid, or it was revoked.");
    await expectError(await POST(call({ mass: "21.5" }, { headers: bearer("cdk_" + "x".repeat(43)) })), 401);
  });

  it("validates the upload with the same messages as POST /api/v1/parts", async () => {
    const cases: [Record<string, string>, { bytes: Uint8Array; name: string } | null][] = [
      [{}, { bytes: sampleBytes, name: SAMPLE }],
      [{ mass: "21.5" }, null],
      [{ mass: "21.5" }, { bytes: new TextEncoder().encode('{"asset":{"version":"2.0"}}'), name: "part.gltf" }],
      [{ mass: "21.5" }, { bytes: new Uint8Array(64), name: "junk.glb" }],
      [{ mass: "-3" }, { bytes: sampleBytes, name: SAMPLE }],
    ];
    for (const [fields, file] of cases) {
      const designs = await POST(call(fields, { file, headers: bearer(key) }));
      const parts = await createPart(call(fields, { file, path: "/api/v1/parts" }));
      expect(designs.status).toBe(parts.status);
      expect((await expectError(designs, parts.status)).error).toEqual((await expectError(parts, parts.status)).error);
    }
    await expectError(
      await POST(call({ mass: "21.5" }, { file: { bytes: new TextEncoder().encode('{"asset":{"version":"2.0"}}'), name: "part.gltf" }, headers: bearer(key) })),
      415,
      GLB_MESSAGES.textGltf,
    );
  });

  it("refuses bad totals and freight rates", async () => {
    const body = await expectError(await POST(call({ mass: "21.5", total: "0" }, { headers: bearer(key) })), 400);
    expect(body.error.field).toBe("total");
    expect((await expectError(await POST(call({ mass: "21.5", freightRates: "{" }, { headers: bearer(key) })), 400)).error.field).toBe("freightRates");
  });
});
