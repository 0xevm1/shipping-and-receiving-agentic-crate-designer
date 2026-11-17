import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { DEFAULT_SETTINGS } from "./design";
import { planTotalShipment, shipmentBom, TotalSplitSchema, type TotalSplit } from "./shipment";
import { DEFAULT_STANDARDS } from "./standards";
import { planTotal, sweepQuantities, type TotalPlan } from "./sweep";
import { loadAwareBudget } from "./testFixtures";

/**
 * A job's total quantity designed whole (#140): `planTotalShipment` makes the crates of `planTotal`'s
 * split, so the shipment's totals are the ones the plan priced, whatever the total.
 */
const splitOf = (p: TotalPlan): TotalSplit => ({
  parts: p.total,
  types: p.types.map((t) => ({ count: t.count, quantity: t.quantity, layoutKey: t.crate.layoutKey })),
});
const settings = { ...DEFAULT_SETTINGS, quantity: 1 };

describe("planTotalShipment", () => {
  it.each(catalog.parts.flatMap((p) => [1000, 10000].map((total) => [p.id, total] as const)))(
    "%s at %i parts ships exactly the parts, as the plan priced them",
    (id, total) => {
      const part = catalog.parts.find((p) => p.id === id)!;
      const sweep = sweepQuantities(part, settings, DEFAULT_STANDARDS);
      const plan = planTotal(sweep, total)!;
      const ship = planTotalShipment(part, settings, splitOf(plan), DEFAULT_STANDARDS);
      expect(ship.total).toBe(total);
      expect(ship.totals.parts).toBe(total);
      expect(ship.totals.crates).toBe(plan.crates);
      expect(ship.crates.map((c) => [c.label, c.count, c.quantity])).toEqual(plan.types.map((t) => [t.label, t.count, t.quantity]));
      for (const c of ship.crates) expect(c.result.design!.layout.slots).toHaveLength(c.quantity);
      // The sweep priced the same crates (wood, screws and labour), so the whole shipment costs what the plan said.
      expect(ship.totals.costUsd).toBeCloseTo(plan.crateCostUsd, 6);
      expect(shipmentBom(ship).lumberM).toBeGreaterThan(0);
      expect(ship.problem).toBeNull();
      expect(ship.split).toBe(plan.crates > 1);
    },
  );

  it("is not the plan of the 200 parts on screen: its totals follow the parts to ship", () => {
    const part = catalog.parts[0]!;
    const plan = planTotal(sweepQuantities(part, settings, DEFAULT_STANDARDS), 10000)!;
    const a = planTotalShipment(part, { ...settings, quantity: 5 }, splitOf(plan));
    const b = planTotalShipment(part, { ...settings, quantity: 200 }, splitOf(plan));
    expect(a.totals).toEqual(b.totals);
    expect(a.totals.parts).toBe(10000);
  });

  it("a total that fits one crate is one crate, still a total", () => {
    const part = catalog.parts[0]!;
    const plan = planTotal(sweepQuantities(part, settings, DEFAULT_STANDARDS), 4)!;
    const ship = planTotalShipment(part, settings, splitOf(plan));
    expect(ship).toMatchObject({ split: false, total: 4 });
    expect(ship.totals).toMatchObject({ crates: 1, parts: 4 });
  });
});

describe("TotalSplitSchema", () => {
  const ok = {
    parts: 100,
    types: [
      { count: 3, quantity: 30, layoutKey: "k" },
      { count: 1, quantity: 10, layoutKey: null },
    ],
  };

  it("takes the crate types of a plan", () => expect(TotalSplitSchema.safeParse(ok).success).toBe(true));

  it("refuses crate types that don't make up the parts, more than two types, and more than 200 to a crate", () => {
    expect(TotalSplitSchema.safeParse({ ...ok, parts: 101 }).success).toBe(false);
    expect(TotalSplitSchema.safeParse({ parts: 3, types: [1, 1, 1].map((q) => ({ count: 1, quantity: q, layoutKey: null })) }).success).toBe(false);
    expect(TotalSplitSchema.safeParse({ parts: 201, types: [{ count: 1, quantity: 201, layoutKey: null }] }).success).toBe(false);
    expect(TotalSplitSchema.safeParse({ parts: 0, types: [] }).success).toBe(false);
  });
});

describe("planning a total is fast (#140)", () => {
  // Measured on an M-series Mac: planTotal 0.2-4.5 ms and the two crate designs 1-4 ms at 1,000 and 10,000
  // parts, for every sample part. The budgets are generous and follow the machine's load (#48), so a
  // 10x regression fails when idle and a busy commit hook does not.
  it.each([1000, 10000])("plans and designs %i parts of every sample part", (total) => {
    const budget = loadAwareBudget(150, 40);
    for (const part of catalog.parts) {
      const sweep = sweepQuantities(part, settings, DEFAULT_STANDARDS);
      let t = performance.now();
      const plan = planTotal(sweep, total)!;
      expect(performance.now() - t).toBeLessThan(budget);
      t = performance.now();
      const ship = planTotalShipment(part, settings, splitOf(plan));
      expect(performance.now() - t).toBeLessThan(budget);
      // At most two crate types are designed, so the work does not grow with the total.
      expect(ship.crates.length).toBeLessThanOrEqual(2);
    }
  });
});
