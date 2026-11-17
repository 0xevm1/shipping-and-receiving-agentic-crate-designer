// `engine.updated` on server start (#46 §3, docs/POSTGRES.md "Engine updates"): one event per org
// per new engine version, however many instances start at once. Needs `bun run infra:up`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG, orgContext } from "../db/org";
import { org } from "../db/schema";
import { createTestDatabase, type TestDatabase } from "../db/testing";
import { announceEngineOnStart } from "./announce";

let t: TestDatabase;
let second: string;

beforeAll(async () => {
  t = await createTestDatabase("engine");
  [{ id: second }] = await t.db.insert(org).values({ slug: "second", name: "Second org" }).returning({ id: org.id });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  vi.restoreAllMocks();
  await t?.drop();
});

const engineEvents = () => t.sql<{ org_id: string; job_id: string | null; payload: { engineVersion: string } }[]>`
  select org_id, job_id, payload from event where type = 'engine.updated' order by id`;

describe("announceEngineOnStart", () => {
  it("emits one org-wide engine.updated per org, once, when two instances start together", async () => {
    const results = await Promise.all([announceEngineOnStart("9.0.0+engine.1", t.url), announceEngineOnStart("9.0.0+engine.1", t.url)]);
    expect(results.filter((r) => r?.announced)).toHaveLength(1);
    expect(results.filter((r) => r && !r.announced)).toHaveLength(1);
    const rows = await engineEvents();
    expect(rows.map((r) => r.org_id).sort()).toEqual([DEFAULT_ORG.orgId, second].sort());
    expect(rows.every((r) => r.job_id === null && r.payload.engineVersion === "9.0.0+engine.1")).toBe(true);
  });

  it("announces nothing on a restart, and again for the next version", async () => {
    expect(await announceEngineOnStart("9.0.0+engine.1", t.url)).toEqual({ announced: false });
    expect(await announceEngineOnStart("9.0.0+engine.2", t.url)).toEqual({ announced: true, orgs: 2 });
    expect((await engineEvents()).map((r) => r.payload.engineVersion)).toEqual(["9.0.0+engine.1", "9.0.0+engine.1", "9.0.0+engine.2", "9.0.0+engine.2"]);
  });

  it("reaches every job's event stream of the org", async () => {
    const ctx = orgContext(second);
    const part = await t.repo.parts.create(ctx, { name: "Bracket", massKg: 2, sizeXMm: 100, sizeYMm: 100, sizeZMm: 100, source: "upload" });
    const job = await t.repo.jobs.create(ctx, { partId: part.id, totalQuantity: null });
    const types = (await t.repo.events.listForStream(ctx, job.id)).map((e) => [e.type, e.payload.engineVersion]);
    expect(types).toEqual([
      ["engine.updated", "9.0.0+engine.1"],
      ["engine.updated", "9.0.0+engine.2"],
    ]);
  });

  it("never throws when the database is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await announceEngineOnStart("9.0.0+engine.3", "postgres://crate:crate@127.0.0.1:1/none")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
