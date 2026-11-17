import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ORG, MissingOrgContextError, type OrgContext, orgContext } from "./org";
import type { NewConfiguration, Part } from "./repository";
import { org } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase;
let other: OrgContext;
let widget: Part;

beforeAll(async () => {
  t = await createTestDatabase("repo");
  const [row] = await t.db.insert(org).values({ slug: "other", name: "Other org" }).returning();
  other = orgContext(row!.id);
  widget = await t.repo.parts.create(DEFAULT_ORG, {
    name: "Widget",
    material: "steel",
    densityKgM3: 7850,
    massKg: 21.5,
    sizeXMm: 300,
    sizeYMm: 200,
    sizeZMm: 150,
    source: "upload",
  });
});
afterAll(() => t?.drop());

const config = (jobId: string, inputHash: string): NewConfiguration => ({
  jobId,
  inputHash,
  quantityPerCrate: 12,
  layout: "grid",
  settings: { clearanceMm: 25 },
  resultSummary: { outsideMm: [1200, 1000, 800] },
  score: 4.2,
  origin: "user",
  engineVersion: "test",
});

describe("org-scoped repository", () => {
  it("inserts and reads back through the default org", async () => {
    expect(widget.orgId).toBe(DEFAULT_ORG.orgId);
    expect(await t.repo.parts.get(DEFAULT_ORG, widget.id)).toEqual(widget);
    expect((await t.repo.parts.list(DEFAULT_ORG)).map((p) => p.id)).toContain(widget.id);
  });

  it("does not show one org's rows to another, even by id", async () => {
    expect(await t.repo.parts.get(other, widget.id)).toBeUndefined();
    expect(await t.repo.parts.list(other)).toEqual([]);
  });

  it("refuses to link rows across orgs (composite foreign keys)", async () => {
    await expect(t.repo.jobs.create(other, { partId: widget.id })).rejects.toThrow();
  });

  it("refuses to run without an OrgContext", async () => {
    // @ts-expect-error: an OrgContext is required.
    await expect(t.repo.parts.list()).rejects.toThrow(MissingOrgContextError);
    // @ts-expect-error: a plain object with an org id is not an OrgContext.
    await expect(t.repo.parts.list({ orgId: DEFAULT_ORG.orgId })).rejects.toThrow(MissingOrgContextError);
    // @ts-expect-error: null is not an OrgContext.
    await expect(t.repo.parts.get(null, widget.id)).rejects.toThrow(MissingOrgContextError);
    expect(() => orgContext("not-a-uuid")).toThrow();
  });

  it("stores a configuration once per (org, inputHash)", async () => {
    const job = await t.repo.jobs.create(DEFAULT_ORG, { partId: widget.id, totalQuantity: 40 });
    const first = await t.repo.configurations.save(DEFAULT_ORG, config(job.id, "hash-a"));
    const again = await t.repo.configurations.save(DEFAULT_ORG, { ...config(job.id, "hash-a"), score: 99 });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.row).toEqual(first.row);
    expect(await t.repo.configurations.listForJob(DEFAULT_ORG, job.id)).toHaveLength(1);

    // The database enforces it too, not just the repository.
    await expect(
      t.sql`insert into configuration (org_id, job_id, input_hash, quantity_per_crate, layout, settings, origin, engine_version)
            values (${DEFAULT_ORG.orgId}, ${job.id}, 'hash-a', 1, 'grid', '{}', 'user', 'test')`,
    ).rejects.toThrow(/configuration_org_id_input_hash_key/);

    // The same hash in another org is a different row, and invisible across orgs.
    const { name, massKg, sizeXMm, sizeYMm, sizeZMm } = widget;
    const otherPart = await t.repo.parts.create(other, { name, massKg, sizeXMm, sizeYMm, sizeZMm, source: "catalog" });
    const otherJob = await t.repo.jobs.create(other, { partId: otherPart.id });
    const theirs = await t.repo.configurations.save(other, config(otherJob.id, "hash-a"));
    expect(theirs.created).toBe(true);
    expect(theirs.row.id).not.toBe(first.row.id);
    expect((await t.repo.configurations.getByHash(DEFAULT_ORG, "hash-a"))?.id).toBe(first.row.id);
  });

  it("updates a job only at the version it read (optimistic concurrency)", async () => {
    const job = await t.repo.jobs.create(DEFAULT_ORG, { partId: widget.id });
    expect(job.version).toBe(1);
    const updated = await t.repo.jobs.update(DEFAULT_ORG, job.id, 1, { status: "ready", notes: "ok" });
    expect(updated).toMatchObject({ version: 2, status: "ready", notes: "ok" });
    expect(await t.repo.jobs.update(DEFAULT_ORG, job.id, 1, { notes: "stale" })).toBeUndefined();
    expect(await t.repo.jobs.update(other, job.id, 2, { notes: "wrong org" })).toBeUndefined();
    expect((await t.repo.jobs.get(DEFAULT_ORG, job.id))?.notes).toBe("ok");
  });

  it("stores a part model once per (org, sha256)", async () => {
    const model = { sha256: "a".repeat(64), sizeBytes: 1234, objectKey: `org/${DEFAULT_ORG.orgId}/models/${"a".repeat(64)}.glb` };
    expect((await t.repo.partModels.put(DEFAULT_ORG, model)).created).toBe(true);
    expect((await t.repo.partModels.put(DEFAULT_ORG, model)).created).toBe(false);
    expect(await t.repo.partModels.get(other, model.sha256)).toBeUndefined();
  });

  it("appends events and lists them after an id, per org", async () => {
    const job = await t.repo.jobs.create(DEFAULT_ORG, { partId: widget.id });
    const a = await t.repo.events.append(DEFAULT_ORG, { jobId: job.id, type: "job.created" });
    const b = await t.repo.events.append(DEFAULT_ORG, { jobId: job.id, type: "configs.ready", payload: { n: 3 } });
    expect((await t.repo.events.listAfter(DEFAULT_ORG, job.id)).map((e) => e.id)).toEqual([a.id, b.id]);
    expect((await t.repo.events.listAfter(DEFAULT_ORG, job.id, a.id)).map((e) => e.id)).toEqual([b.id]);
    expect(await t.repo.events.listAfter(other, job.id)).toEqual([]);
  });
});
