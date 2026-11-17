import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import type { Check } from "./check";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { handlingChecks } from "./handling";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards, type ShopStandards } from "./standards";
import { custom, metricText as metric } from "./testFixtures";

const one = computeDesign(getPart("PART-001"), { ...DEFAULT_SETTINGS, quantity: 1 }, null, DEFAULT_STANDARDS).design!;
const limit = DEFAULT_STANDARDS.handling.handCarryMaxKg;
const withGross = (grossKg: number, standards: ShopStandards = DEFAULT_STANDARDS) => handlingChecks({ ...one.handling, grossKg }, standards);
const ids = (checks: Check[]) => checks.map((c) => c.id);
const DEVICES = ["cog-offset", "cog-tip", "forklift", "pallet-jack"];

describe("hand-carry crates (#113)", () => {
  it("replaces the forklift and pallet-jack rows with one passing row at the limit", () => {
    const checks = withGross(limit);
    expect(ids(checks)).toEqual(["cog-offset", "cog-tip", "hand-carry"]);
    const row = checks.find((c) => c.id === "hand-carry")!;
    expect(row).toMatchObject({ level: "ok", title: "Light enough to carry by hand" });
    expect(metric(row.detail)).toBe("Gross 23 kg, at or under the 23 kg hand-carry limit, so it needs no forklift or pallet jack.");
  });

  it("is a pass just under the limit and keeps the device rows just over it", () => {
    expect(ids(withGross(limit - 0.01))).toContain("hand-carry");
    expect(ids(withGross(limit + 0.01))).toEqual(DEVICES);
  });

  it("follows the standard, and 0 turns it off", () => {
    expect(ids(withGross(1, custom({ handling: { handCarryMaxKg: 0 } })))).toEqual(DEVICES);
    expect(ids(withGross(30, custom({ handling: { handCarryMaxKg: 30 } })))).toContain("hand-carry");
  });

  it("judges the gross weight of the whole crate, boards plus parts", () => {
    const d = computeDesign(getPart("PART-001"), { ...DEFAULT_SETTINGS, quantity: 3 }, null, DEFAULT_STANDARDS).design!;
    expect(d.handling.grossKg).toBeCloseTo(d.grossKg, 6);
  });

  it("gives the 0.05 kg pin of the issue the hand-carry row, and a 42 kg crate the devices", () => {
    const pin = { id: "pin", name: "pin", mass_kg: 0.05, dimensions_mm: [40, 30, 20] as [number, number, number], material: "steel" as const };
    const d = computeDesign(pin, { ...DEFAULT_SETTINGS, quantity: 1 }, null, DEFAULT_STANDARDS).design!;
    expect(ids(d.checks)).toContain("hand-carry");
    expect(ids(d.checks)).not.toContain("forklift");
    expect(ids(one.checks)).toContain("forklift");
  });

  it("parses standards saved without the field, with the default", () => {
    const old: Record<string, unknown> = { ...DEFAULT_STANDARDS.handling };
    delete old.handCarryMaxKg;
    const r = parseStandards({ ...DEFAULT_STANDARDS, handling: old });
    expect(r.ok && r.standards.handling.handCarryMaxKg).toBe(23);
    expect(parseStandards(mergeStandards(DEFAULT_STANDARDS, { handling: { handCarryMaxKg: -1 } })).ok).toBe(false);
  });
});
