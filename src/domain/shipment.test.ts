import { describe, expect, it } from "vitest";
import { catalog, getPart } from "./catalog";
import { computeDesign } from "./design";
import { describeShipment, planShipment, shipmentBom, withinOutsideLimits, type ShipmentPlan } from "./shipment";
import type { DesignPart } from "./schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";
import { custom, settings, metricText as metric } from "./testFixtures";



/** Every crate in the plan respects the per-crate limits. */
function expectWithinLimits(plan: ShipmentPlan, standards: ShopStandards = DEFAULT_STANDARDS) {
  for (const c of plan.crates) {
    const d = c.result.design!;
    expect(d.grossKg).toBeLessThanOrEqual(standards.limits.perCrate.maxGrossKg);
    expect(withinOutsideLimits(d.layout.external, standards)).toBe(true);
    if (standards.limits.perCrate.maxParts > 0) expect(c.quantity).toBeLessThanOrEqual(standards.limits.perCrate.maxParts);
    expect(d.layout.slots).toHaveLength(c.quantity);
  }
}

const partsIn = (plan: ShipmentPlan) => plan.crates.reduce((n, c) => n + c.count * c.quantity, 0);

describe("planShipment: one crate when it fits", () => {
  it("is exactly computeDesign for every sample part at its suggested quantities", () => {
    for (const p of catalog.parts) {
      for (const quantity of p.suggested_quantities) {
        for (const keepUpright of [true, false]) {
          const s = settings({ quantity, keepUpright });
          const plan = planShipment(p, s);
          expect(plan.split).toBe(false);
          expect(plan.crates).toHaveLength(1);
          expect(plan.crates[0]).toMatchObject({ label: "A", count: 1, quantity });
          // Same design, value for value: the 18-case baseline can't move.
          expect(plan.crates[0].result).toEqual(computeDesign(p, s));
          expect(plan.unmet).toBeNull();
        }
      }
    }
  });

  it("keeps the user's layout pick", () => {
    const p = getPart("PART-001");
    const keys = computeDesign(p, settings({ quantity: 8 })).layouts.map((l) => l.key);
    const plan = planShipment(p, settings({ quantity: 8 }), keys[2]);
    expect(plan.crates[0].result.design!.layout.key).toBe(keys[2]);
  });

  it("totals match the single crate", () => {
    const p = getPart("PART-003");
    const plan = planShipment(p, settings({ quantity: 8 }));
    const d = plan.crates[0].result.design!;
    expect(plan.totals).toMatchObject({ crates: 1, parts: 8, grossKg: d.grossKg, volumeM3: d.layout.externalVolumeM3 });
  });

  it("passes a problem straight through, with no split", () => {
    const bad: DesignPart = { id: "x", name: "Flat", mass_kg: 1, dimensions_mm: [100, 100, 0] };
    const plan = planShipment(bad, settings({ quantity: 50 }));
    expect(plan.problem?.id).toBe("part-size");
    expect(plan.split).toBe(false);
    expect(plan.crates[0].result.design).toBeNull();
  });
});

describe("planShipment: splitting a batch", () => {
  it("splits 200 brackets into crates within the 1,000 kg limit", () => {
    const p = getPart("PART-001");
    const plan = planShipment(p, settings({ quantity: 200 }));
    expect(plan.split).toBe(true);
    expect(partsIn(plan)).toBe(200);
    expectWithinLimits(plan);
    expect(plan.crates.length).toBeLessThanOrEqual(2);
    expect(plan.crates[0].label).toBe("A");
    if (plan.crates[1]) {
      expect(plan.crates[1]).toMatchObject({ label: "B", count: 1 });
      expect(plan.crates[1].quantity).toBeLessThan(plan.crates[0].quantity);
    }
    expect(plan.totals.parts).toBe(200);
    expect(plan.totals.grossKg).toBeCloseTo(plan.crates.reduce((g, c) => g + c.count * c.result.design!.grossKg, 0), 6);
    expect(plan.totals.payloadKg).toBeCloseTo(200 * 21.5, 6);
    expect(plan.unmet).toBeNull();
  });

  it("uses the fewest crates: one crate fewer would hold too many parts", () => {
    for (const p of catalog.parts) {
      const plan = planShipment(p, settings({ quantity: 200 }));
      const n = plan.totals.crates;
      // With n − 1 crates, some crate holds at least ceil(200 / (n − 1)) parts, and that is over a limit.
      expect(planShipment(p, settings({ quantity: Math.ceil(200 / (n - 1)) })).split).toBe(true);
      expect(n).toBe(Math.ceil(200 / plan.crates[0].quantity));
      expectWithinLimits(plan);
    }
  });

  it("splits by part count, evenly, with no remainder when it divides", () => {
    const p = getPart("PART-003");
    const plan = planShipment(p, settings({ quantity: 8 }), null, custom({ limits: { perCrate: { maxParts: 4 } } }));
    expect(plan.crates).toHaveLength(1);
    expect(plan.crates[0]).toMatchObject({ count: 2, quantity: 4 });
    expect(describeShipment(plan)).toBe("2 × crate A (4 each)");
  });

  it("puts the leftover parts in one smaller remainder crate", () => {
    const p = getPart("PART-003");
    // 10 parts, at most 4 per crate: 3 crates. 4 + 4 + 2 or 4 + 3 + 3 aren't "N identical + one",
    // so the plan is 2 × 4 + 1 × 2.
    const plan = planShipment(p, settings({ quantity: 10 }), null, custom({ limits: { perCrate: { maxParts: 4 } } }));
    expect(plan.totals.crates).toBe(3);
    expect(plan.crates.map((c) => [c.count, c.quantity])).toEqual([
      [2, 4],
      [1, 2],
    ]);
    expect(describeShipment(plan)).toBe("2 × crate A (4 each) + 1 × crate B (2)");
  });

  it("prefers an even split when the volumes tie", () => {
    const p = getPart("PART-003");
    // At most 40 per crate, 100 parts: 3 crates either way. 2 × 34 + 32 is far more even
    // than 2 × 40 + 20, and ships about the same volume.
    const plan = planShipment(p, settings({ quantity: 100 }), null, custom({ limits: { perCrate: { maxParts: 40, maxGrossKg: 100000 } } }));
    expect(plan.totals.crates).toBe(3);
    const [a, b] = plan.crates;
    expect(a.count).toBe(2);
    expect(a.quantity - (b?.quantity ?? a.quantity)).toBeLessThanOrEqual(6);
  });

  it("splits a batch too big for the trailer door and floor", () => {
    const p = getPart("PART-002");
    const s = settings({ quantity: 40 });
    const small = custom({
      limits: { perCrate: { maxGrossKg: 100000 }, trailerMm: { interiorLength: 3000, doorWidth: 1500 } },
    });
    // No layout of 40 shafts fits the smaller trailer.
    expect(computeDesign(p, s, null, small).layouts.some((l) => withinOutsideLimits(l.external, small))).toBe(false);
    const plan = planShipment(p, s, null, small);
    expect(plan.split).toBe(true);
    expect(partsIn(plan)).toBe(40);
    expectWithinLimits(plan, small);
    for (const c of plan.crates) expect(c.result.design!.checks.find((x) => x.id === "door")?.level).toBe("ok");
  });

  it("recommends a layout that fits through the door when the smallest one doesn't", () => {
    const p = getPart("PART-001");
    const low = custom({ limits: { trailerMm: { doorHeight: 600, interiorHeight: 2794 } } });
    const plan = planShipment(p, settings({ quantity: 8 }), null, low);
    for (const c of plan.crates) {
      const r = c.result;
      expect(withinOutsideLimits(r.layouts[0].external, low)).toBe(true);
      expect(r.design!.layout.key).toBe(r.layouts[0].key);
    }
  });

  it("follows a lower max gross: more crates", () => {
    const p = getPart("PART-001");
    const a = planShipment(p, settings({ quantity: 200 }));
    const lower = custom({ limits: { perCrate: { maxGrossKg: 500 } } });
    const b = planShipment(p, settings({ quantity: 200 }), null, lower);
    expect(b.totals.crates).toBeGreaterThan(a.totals.crates);
    expectWithinLimits(b, lower);
  });

  it("applies a layout pick to the crate type that has it", () => {
    const p = getPart("PART-001");
    const plan = planShipment(p, settings({ quantity: 200 }));
    const typeA = plan.crates[0].result;
    const pick = typeA.layouts[1].key;
    const picked = planShipment(p, settings({ quantity: 200 }), pick);
    expect(picked.crates[0].result.design!.layout.key).toBe(pick);
    expect(picked.crates.map((c) => [c.count, c.quantity])).toEqual(plan.crates.map((c) => [c.count, c.quantity]));
  });

  it("adds a per-crate limit check to each crate of a split", () => {
    const plan = planShipment(getPart("PART-001"), settings({ quantity: 200 }));
    for (const c of plan.crates) {
      const check = c.result.design!.checks.find((x) => x.id === "crate-limit");
      expect(check?.level).toBe("ok");
      expect(metric(check!.detail)).toMatch(/1,000 kg/);
    }
    // A single crate doesn't get one: the experience is unchanged.
    const one = planShipment(getPart("PART-001"), settings({ quantity: 4 }));
    expect(one.crates[0].result.design!.checks.some((x) => x.id === "crate-limit")).toBe(false);
  });

  it("ships one part per crate, with a caution, when even one part is over the limit", () => {
    const heavy: DesignPart = { id: "anvil", name: "Anvil", mass_kg: 1200, dimensions_mm: [500, 400, 300] };
    const plan = planShipment(heavy, settings({ quantity: 3 }));
    expect(plan.crates).toHaveLength(1);
    expect(plan.crates[0]).toMatchObject({ count: 3, quantity: 1 });
    expect(metric(plan.unmet!)).toMatch(/one part/i);
    expect(plan.crates[0].result.design!.checks.find((x) => x.id === "crate-limit")?.level).toBe("caution");
    // A single heavy part stays as today: one crate, with the base-rating caution.
    const single = planShipment(heavy, settings({ quantity: 1 }));
    expect(single.split).toBe(false);
    expect(single.crates[0].result).toEqual(computeDesign(heavy, settings({ quantity: 1 })));
  });

  it("is fast at 200 parts", () => {
    for (const p of catalog.parts) {
      for (const keepUpright of [true, false]) {
        const t = performance.now();
        const plan = planShipment(p, settings({ quantity: 200, keepUpright }));
        expect(performance.now() - t).toBeLessThan(200);
        expect(partsIn(plan)).toBe(200);
      }
    }
    // A light, small part where only the part count limits: many candidate splits.
    const light: DesignPart = { id: "pin", name: "Pin", mass_kg: 0.5, dimensions_mm: [60, 40, 30] };
    const t = performance.now();
    const plan = planShipment(light, settings({ quantity: 200 }), null, custom({ limits: { perCrate: { maxParts: 199 } } }));
    expect(performance.now() - t).toBeLessThan(500);
    expect(plan.totals.crates).toBe(2);
  });
});

describe("shipmentBom", () => {
  it("is the crate's cut list for a single crate", () => {
    const plan = planShipment(getPart("PART-001"), settings({ quantity: 4 }));
    const d = plan.crates[0].result.design!;
    const all = shipmentBom(plan);
    expect(all.lines).toEqual(d.bom);
    expect(all).toMatchObject({ plywoodM2: d.plywoodM2, lumberM: d.lumberM, screws: d.screws });
  });

  it("multiplies each crate type by its count and merges equal pieces", () => {
    const plan = planShipment(getPart("PART-003"), settings({ quantity: 10 }), null, custom({ limits: { perCrate: { maxParts: 4 } } }));
    const all = shipmentBom(plan);
    const pieces = (lines: { qty: number }[]) => lines.reduce((n, l) => n + l.qty, 0);
    const expected = plan.crates.reduce((n, c) => n + c.count * pieces(c.result.design!.bom), 0);
    expect(pieces(all.lines)).toBe(expected);
    expect(new Set(all.lines.map((l) => l.key)).size).toBe(all.lines.length);
    expect(all.screws).toBe(plan.crates.reduce((n, c) => n + c.count * c.result.design!.screws, 0));
    // Each piece's sizes sit together.
    const labels = all.lines.map((l) => `${l.assembly}|${l.label}`);
    for (const label of new Set(labels)) {
      const at = labels.flatMap((x, i) => (x === label ? [i] : []));
      expect(at[at.length - 1] - at[0]).toBe(at.length - 1);
    }
  });
});
