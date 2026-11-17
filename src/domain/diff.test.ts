import { describe, expect, it } from "vitest";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { DESIGN_FIELDS, diffDesigns } from "./diff";
import type { CrateSettings, DesignPart } from "./schema";

const part = (mass_kg: number, dimensions_mm: [number, number, number] = [300, 200, 100]): DesignPart => ({
  id: "t",
  name: "Test",
  mass_kg,
  dimensions_mm,
});
const design = (p: DesignPart, s: Partial<CrateSettings> = {}) => computeDesign(p, { ...DEFAULT_SETTINGS, ...s }).design!;

describe("diffDesigns", () => {
  it("finds nothing between equal designs", () => {
    expect(diffDesigns(design(part(10)), design(part(10)))).toEqual([]);
  });

  it("returns nothing when either side has no design", () => {
    expect(diffDesigns(null, design(part(10)))).toEqual([]);
    expect(diffDesigns(design(part(10)), null)).toEqual([]);
  });

  it("reports a heavier tiny part as payload and gross only (the crate is the fixed minimum)", () => {
    // The #39 case: a 1 mm part, 10 → 14.71 kg. Gross goes ~16 → ~20 kg; nothing else moves.
    const tiny: [number, number, number] = [1, 1, 1];
    const a = design(part(10, tiny), { quantity: 1 });
    const b = design(part(14.71, tiny), { quantity: 1 });
    const d = diffDesigns(a, b);
    expect(d.map((c) => c.field)).toEqual(["gross", "payload"]);
    expect(d[0].from).toBeCloseTo(a.grossKg);
    expect(d[0].to).toBeCloseTo(b.grossKg);
    expect(Math.round(d[0].from as number)).toBe(16);
    expect(Math.round(d[0].to as number)).toBe(20);
    expect(d[1]).toEqual({ field: "payload", from: 10, to: 14.71 });
  });

  it("reports plywood, skids, tare and outside size when the load steps up the construction", () => {
    const a = design(part(10), { quantity: 4 });
    const b = design(part(200), { quantity: 4 }); // 800 kg payload: 19 mm ply and taller skids
    const d = diffDesigns(a, b);
    const fields = d.map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(["gross", "panel", "skid", "payload", "tare", "outside"]));
    expect(d.find((c) => c.field === "panel")).toEqual({ field: "panel", from: 12, to: 19 });
    expect(d.find((c) => c.field === "skid")).toEqual({ field: "skid", from: [89, 89], to: [89, 140] });
  });

  it("reports the layout grid and outside size when the quantity changes", () => {
    const a = design(part(10), { quantity: 1 });
    const b = design(part(10), { quantity: 4 });
    const d = diffDesigns(a, b);
    const grid = d.find((c) => c.field === "grid")!;
    expect(grid.from).toEqual(a.layout.counts);
    expect(grid.to).toEqual(b.layout.counts);
    expect(d.find((c) => c.field === "outside")).toEqual({ field: "outside", from: a.layout.external, to: b.layout.external });
  });

  it("reports a hand-set panel thickness and lists changes in DESIGN_FIELDS order", () => {
    const d = diffDesigns(design(part(10)), design(part(10), { panelThickness: 15 }));
    expect(d.find((c) => c.field === "panel")).toEqual({ field: "panel", from: 12, to: 15 });
    const order = d.map((c) => DESIGN_FIELDS.indexOf(c.field));
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("ignores floating-point noise in weights", () => {
    const a = design(part(10));
    const b = { ...a, grossKg: a.grossKg + 1e-9, tareKg: a.tareKg - 1e-9 };
    expect(diffDesigns(a, b)).toEqual([]);
  });
});
