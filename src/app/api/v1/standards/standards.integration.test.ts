// Shop standards on the server (#46, #19): `GET`/`PUT /api/v1/standards` through the Route Handler,
// and the queue's sweep running on the org's stored standards. Needs `bun run infra:up`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, type ShopStandards } from "@/domain/standards";
import type { SweepRequest } from "@/engine/sweep";
import { ApiErrorSchema } from "@/lib/api/parts";
import { StandardsResponseSchema } from "@/lib/api/standards";
import { GET, PUT } from "./route";
import { closeDb, DEFAULT_ORG } from "@/server/db";
import { createTestDatabase, type TestDatabase } from "@/server/db/testing";
import { createJobHandlers } from "@/server/queue/jobs";
import type { EnginePool } from "@/server/workers/pool";

let t: TestDatabase;
const saved = { DATABASE_URL: process.env.DATABASE_URL };

beforeAll(async () => {
  t = await createTestDatabase("standards");
  process.env.DATABASE_URL = t.url;
});
afterAll(async () => {
  await closeDb();
  Object.assign(process.env, saved);
  await t?.drop();
});

const URL_ = "http://localhost/api/v1/standards";
const put = (body: unknown) => PUT(new Request(URL_, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const withWood = (plywood: number): ShopStandards => ({
  ...structuredClone(DEFAULT_STANDARDS),
  rates: { ...DEFAULT_STANDARDS.rates, costUsdPerM3: { plywood, lumber: 650 } },
});

describe("/api/v1/standards", () => {
  it("serves the defaults while the org has stored none, then versions each save", async () => {
    const first = StandardsResponseSchema.parse(await (await GET(new Request(URL_))).json());
    expect(first).toEqual({ standards: DEFAULT_STANDARDS, version: null, source: "default", updatedAt: null });

    const v1 = await put({ standards: withWood(1200), baseVersion: null });
    expect(v1.status).toBe(200);
    expect(StandardsResponseSchema.parse(await v1.json())).toMatchObject({ version: 1, source: "org" });

    const v2 = StandardsResponseSchema.parse(await (await put({ standards: withWood(1300), baseVersion: 1 })).json());
    expect(v2.version).toBe(2);
    const now = StandardsResponseSchema.parse(await (await GET(new Request(URL_))).json());
    expect(now).toMatchObject({ version: 2, source: "org" });
    expect(now.standards.rates.costUsdPerM3.plywood).toBe(1300);
  });

  it("refuses a stale base with 409 and the current standards", async () => {
    const res = await put({ standards: withWood(999), baseVersion: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(ApiErrorSchema.parse(body).error.code).toBe("version_conflict");
    expect(StandardsResponseSchema.parse(body.current).version).toBe(2);
  });

  it("lets only one of two concurrent saves on the same base win", async () => {
    const statuses = (await Promise.all([put({ standards: withWood(1400), baseVersion: 2 }), put({ standards: withWood(1500), baseVersion: 2 })])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([200, 409]);
    expect((await t.repo.standards.current(DEFAULT_ORG))!.version).toBe(3);
  });

  it("refuses invalid or partial standards with 400 naming the field", async () => {
    const bad = withWood(1200);
    (bad.stock.cleatMm as { wide: number }).wide = 1;
    const res = await put({ standards: bad, baseVersion: 3 });
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(await res.json()).error.field).toBe("standards.stock.cleatMm.wide");
    expect((await put({ standards: { rates: {} }, baseVersion: 3 })).status).toBe(400);
  });
});

describe("the queue's sweep", () => {
  it("runs on the org's stored standards", async () => {
    const part = await t.repo.parts.create(DEFAULT_ORG, { name: "Bracket", massKg: 21.5, sizeXMm: 300, sizeYMm: 200, sizeZMm: 150, source: "upload" });
    const job = await t.repo.jobs.create(DEFAULT_ORG, { partId: part.id, totalQuantity: null });
    const seen: SweepRequest[] = [];
    const pool = {
      run: async (task: string, req: SweepRequest) => {
        seen.push(req);
        expect(task).toBe("designs");
        return { configurations: [], engineVersion: "test", inputHash: "h", problem: null, curve: [], total: null };
      },
    } as unknown as EnginePool;
    const queued = (await t.repo.queue.enqueue(DEFAULT_ORG, { kind: "sweep", payload: { jobId: job.id } })).job;
    await createJobHandlers({ db: t.db, pool }).sweep({ org: DEFAULT_ORG, job: queued, signal: new AbortController().signal });
    const stored = (await t.repo.standards.current(DEFAULT_ORG))!;
    expect(seen).toHaveLength(1);
    expect(seen[0]!.standards).toEqual(stored.standards);
    expect(seen[0]!.standards.rates.costUsdPerM3.plywood).not.toBe(DEFAULT_STANDARDS.rates.costUsdPerM3.plywood);
  });
});
