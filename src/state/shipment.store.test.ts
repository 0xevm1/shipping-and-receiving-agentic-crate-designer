import { beforeEach, describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { useDesigner } from "./store";
import { catalogPart } from "@/lib/part";

const initial = useDesigner.getState();
const s = () => useDesigner.getState();

describe("shipment plan in the store", () => {
  beforeEach(() => useDesigner.setState(initial, true));

  it("starts as one crate, the same design as before", () => {
    expect(s().plan.split).toBe(false);
    expect(s().crateIndex).toBe(0);
    expect(s().result).toEqual(computeDesign(getPart("PART-001"), DEFAULT_SETTINGS));
  });

  it("splits 200 brackets and shows crate A", () => {
    s().setSettings({ quantity: 200 });
    expect(s().plan.split).toBe(true);
    expect(s().crateIndex).toBe(0);
    expect(s().result).toBe(s().plan.crates[0].result);
    expect(s().result.design!.layout.slots).toHaveLength(s().plan.crates[0].quantity);
  });

  it("switches the shown crate type", () => {
    s().setSettings({ quantity: 200 });
    expect(s().plan.crates).toHaveLength(2);
    s().setCrateIndex(1);
    expect(s().crateIndex).toBe(1);
    expect(s().result).toBe(s().plan.crates[1].result);
    // Out-of-range picks are ignored.
    s().setCrateIndex(5);
    s().setCrateIndex(-1);
    s().setCrateIndex(0.5);
    expect(s().crateIndex).toBe(1);
  });

  it("keeps the crate type across edits while it exists, and falls back to A when it doesn't", () => {
    s().setSettings({ quantity: 200 });
    s().setCrateIndex(1);
    s().setSettings({ partGapMm: 40 });
    expect(s().crateIndex).toBe(s().plan.crates.length > 1 ? 1 : 0);
    s().setSettings({ quantity: 4 });
    expect(s().crateIndex).toBe(0);
    expect(s().plan.split).toBe(false);
  });

  it("re-plans when the max gross per crate changes", () => {
    s().setSettings({ quantity: 200 });
    const before = s().plan.totals.crates;
    expect(s().setStandards({ limits: { perCrate: { maxGrossKg: 500 } } })).toBeNull();
    expect(s().plan.totals.crates).toBeGreaterThan(before);
    for (const c of s().plan.crates) expect(c.result.design!.grossKg).toBeLessThanOrEqual(500);
  });

  it("loadDesign opens the saved crate type", () => {
    const part = catalogPart(getPart("PART-001"));
    s().loadDesign(part, { ...DEFAULT_SETTINGS, quantity: 200 }, null, 1);
    expect(s().crateIndex).toBe(1);
    expect(s().result).toBe(s().plan.crates[1].result);
  });
});
