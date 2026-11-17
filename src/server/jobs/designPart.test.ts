import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { FACE_IDS, type PartProfile } from "@/domain/profile";
import { designPartHash } from "@/engine/request";
import type { Part } from "../db/repository";
import { isCurrentConfiguration, jobDesignPart, jobPartHash, partToStore, rowDesignPart } from "./designPart";

const catalog = getPart("PART-001");
const row: Part = {
  id: "00000000-0000-4000-8000-0000000000bb",
  orgId: "00000000-0000-4000-8000-000000000001",
  name: catalog.name,
  material: catalog.material,
  densityKgM3: null,
  massKg: catalog.mass_kg,
  sizeXMm: catalog.dimensions_mm[0],
  sizeYMm: catalog.dimensions_mm[1],
  sizeZMm: catalog.dimensions_mm[2],
  modelSha256: null,
  modelUnits: null,
  upAxis: null,
  source: "catalog",
  catalogId: catalog.id,
  createdAt: new Date(0),
};
const face = { cols: 1, rows: 1, depth: [3] };
const PROFILE: PartProfile = {
  version: 1,
  sizeMm: catalog.dimensions_mm,
  cellMm: 2,
  faces: Object.fromEntries(FACE_IDS.map((f) => [f, face])) as PartProfile["faces"],
};
const browserPart = { id: catalog.id, name: catalog.name, mass_kg: catalog.mass_kg, dimensions_mm: catalog.dimensions_mm, material: catalog.material };
const empty = { designPart: null, designPartHash: null };

describe('the job\'s design part (#46 "same inputs")', () => {
  it("is the part row's facts until a browser sends its own", () => {
    expect(jobDesignPart(empty, row)).toEqual({
      id: row.id,
      name: row.name,
      mass_kg: row.massKg,
      dimensions_mm: catalog.dimensions_mm,
      material: catalog.material,
      // A catalog part brings the catalog's suggested quantities, which choose its sweep's recommendation (#133).
      suggested_quantities: catalog.suggested_quantities,
    });
    expect(jobPartHash(empty, row)).toBe(designPartHash(rowDesignPart(row)));
  });

  it("stores the browser's part when it differs, with its hash, and nothing when it is already the job's", () => {
    const first = partToStore(empty, row, { ...browserPart, profile: PROFILE })!;
    expect(first.hash).toBe(designPartHash({ ...browserPart, profile: PROFILE }));
    expect(first.designPart.profile).toEqual(PROFILE);
    const job = { designPart: first.designPart, designPartHash: first.hash };
    expect(jobDesignPart(job, row)).toEqual(first.designPart);
    expect(partToStore(job, row, { ...browserPart, profile: PROFILE })).toBeNull();
    // The row's own facts, sent back, change nothing on a job that has none.
    expect(partToStore(empty, row, rowDesignPart(row))).toBeNull();
  });

  it("never drops a measured outline for the same part sent without one, and keeps it through a mass change", () => {
    const stored = partToStore(empty, row, { ...browserPart, profile: PROFILE })!;
    const job = { designPart: stored.designPart, designPartHash: stored.hash };
    expect(partToStore(job, row, browserPart)).toBeNull();
    const heavier = partToStore(job, row, { ...browserPart, mass_kg: 30 })!;
    expect(heavier.designPart).toMatchObject({ mass_kg: 30, profile: PROFILE });
    // Another size is another outline: it isn't carried over.
    expect(partToStore(job, row, { ...browserPart, dimensions_mm: [100, 100, 100] })!.designPart.profile).toBeUndefined();
  });

  it("stores the part's centre of gravity (#110) and designs the job from it", () => {
    const cog = { offsetMm: [-38.3, 0, -48.6] as [number, number, number], source: "estimated" as const };
    const stored = partToStore(empty, row, { ...browserPart, cog })!;
    expect(stored.designPart.cog).toEqual(cog);
    expect(stored.hash).toBe(designPartHash({ ...browserPart, cog }));
    // It is an input: the same part without it is another version.
    expect(stored.hash).not.toBe(designPartHash(browserPart));
    expect(jobDesignPart({ designPart: stored.designPart }, row).cog).toEqual(cog);
  });

  it("keeps an estimated centre for the same part sent before the browser has estimated it, but not a supplied one", () => {
    const estimated = partToStore(empty, row, { ...browserPart, cog: { offsetMm: [10, 0, 0], source: "estimated" } })!;
    const job = { designPart: estimated.designPart, designPartHash: estimated.hash };
    expect(partToStore(job, row, browserPart)).toBeNull();
    expect(partToStore(job, row, { ...browserPart, mass_kg: 30 })!.designPart.cog).toEqual({ offsetMm: [10, 0, 0], source: "estimated" });
    // Another size is another part: the estimate isn't carried over.
    expect(partToStore(job, row, { ...browserPart, dimensions_mm: [100, 100, 100] })!.designPart.cog).toBeUndefined();

    const supplied = partToStore(empty, row, { ...browserPart, cog: { offsetMm: [10, 0, 0], source: "supplied" } })!;
    const suppliedJob = { designPart: supplied.designPart, designPartHash: supplied.hash };
    // Cleared by the person: the job goes back to the box centre.
    expect(partToStore(suppliedJob, row, browserPart)).not.toBeNull();
    expect(partToStore(suppliedJob, row, browserPart)!.designPart.cog).toBeUndefined();
    // Edited to another centre.
    expect(partToStore(suppliedJob, row, { ...browserPart, cog: { offsetMm: [20, 0, 0], source: "supplied" } })!.designPart.cog?.offsetMm).toEqual([20, 0, 0]);
  });

  it("serves a person's configurations always, and a sweep's only for the current part", () => {
    expect(isCurrentConfiguration({ origin: "user", partHash: "old" }, "new")).toBe(true);
    expect(isCurrentConfiguration({ origin: "precomputed", partHash: "old" }, "new")).toBe(false);
    expect(isCurrentConfiguration({ origin: "precomputed", partHash: "new" }, "new")).toBe(true);
    expect(isCurrentConfiguration({ origin: "precomputed", partHash: null }, "new")).toBe(true);
  });
});
