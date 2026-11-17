import { describe, expect, it } from "vitest";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { bomToCsv } from "./export";
import { cleanPartDetails, MATERIAL_SUGGESTIONS, PART_MATERIAL_MAX, PART_NAME_MAX, partFinish } from "./partDetails";
import type { DesignPart } from "./schema";

describe("cleanPartDetails", () => {
  it("tidies a name and material and keeps a positive mass", () => {
    const r = cleanPartDetails({ name: "  Gear\thousing  ", material: " 6061-T6   aluminum ", mass_kg: 3.2 });
    expect(r).toEqual({ ok: true, details: { name: "Gear housing", material: "6061-T6 aluminum", mass_kg: 3.2 } });
  });

  it("leaves absent fields out of the update", () => {
    const r = cleanPartDetails({ mass_kg: 5 });
    expect(r.ok && Object.keys(r.details)).toEqual(["mass_kg"]);
  });

  it("treats a blank material as cleared", () => {
    const r = cleanPartDetails({ material: "   " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("material" in r.details).toBe(true);
      expect(r.details.material).toBeUndefined();
    }
  });

  it("rejects a blank or overlong name", () => {
    expect(cleanPartDetails({ name: "   " })).toMatchObject({ ok: false, error: expect.stringMatching(/name/) });
    expect(cleanPartDetails({ name: "x".repeat(PART_NAME_MAX + 1) }).ok).toBe(false);
  });

  it("rejects an overlong material", () => {
    expect(cleanPartDetails({ material: "x".repeat(PART_MATERIAL_MAX + 1) }).ok).toBe(false);
  });

  it("rejects a mass that is not a positive number", () => {
    for (const mass_kg of [0, -1, NaN, Infinity]) expect(cleanPartDetails({ mass_kg }).ok).toBe(false);
  });
});

describe("partFinish", () => {
  it("draws aluminum only when the material says so", () => {
    expect(partFinish("6061-T6 aluminum")).toBe("aluminum");
    expect(partFinish("Aluminium 7075")).toBe("aluminum");
    expect(partFinish("4140 steel")).toBe("steel");
    expect(partFinish("cast iron")).toBe("steel");
    expect(partFinish(undefined)).toBe("steel");
  });

  it("covers every suggestion", () => {
    expect(MATERIAL_SUGGESTIONS.map(partFinish)).toEqual(["aluminum", "steel", "steel"]);
  });
});

describe("entered details on the cut list", () => {
  const part: DesignPart = { id: "widget", name: "Gear housing", material: "6061-T6 aluminum", mass_kg: 3.25, dimensions_mm: [300, 200, 100] };
  const design = computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 2 }).design!;

  it("puts the name, material and mass in the CSV header", () => {
    const lines = bomToCsv(part, design).split("\n");
    expect(lines[0]).toBe("# Crate for 2 x widget Gear housing");
    expect(lines[1]).toBe("# Part 6061-T6 aluminum, 3.25 kg each");
  });

  it("says when no material was given", () => {
    expect(bomToCsv({ ...part, material: undefined }, design)).toContain("# Part material not given, 3.25 kg each");
  });
});
