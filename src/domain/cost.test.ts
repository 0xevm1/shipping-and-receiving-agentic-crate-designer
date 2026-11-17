import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { crateCost, estimateLabour, FIXED_ASSEMBLY_STEPS, freightClassFor, freightTerms, NMFC_DENSITY_SCALE } from "./cost";
import { computeDesign, explainLayout, rankByObjective, rankLayouts, RANKINGS, scoreLayouts } from "./design";
import type { CrateSettings } from "./schema";
import { planShipment } from "./shipment";
import { DEFAULT_STANDARDS, standardsFromJson } from "./standards";
import { custom, settings } from "./testFixtures";


const design = (id = "PART-001", patch: Partial<CrateSettings> = {}, standards = DEFAULT_STANDARDS) =>
  computeDesign(getPart(id), settings(patch), null, standards).design!;

describe("estimateLabour", () => {
  const bom = [
    { material: "lumber" as const, stock: "19 × 89", cut: "900", qty: 4 },
    { material: "lumber" as const, stock: "19 × 89", cut: "600", qty: 6 },
    // Same stock and cut as the first line, in another assembly: no new set-up.
    { material: "lumber" as const, stock: "19 × 89", cut: "900", qty: 2 },
    { material: "plywood" as const, stock: "12 mm", cut: "900 × 600", qty: 2 },
  ];

  it("adds cuts, set-ups, screws, assembly steps and handling at the standard minutes", () => {
    const l = estimateLabour(bom, 100, 2);
    expect(l.counts).toEqual({ lumberCuts: 12, plywoodCuts: 2, cutSizes: 3, screws: 100, steps: FIXED_ASSEMBLY_STEPS + 2 });
    expect(l.minutes.cutting).toBeCloseTo(12 * 0.75 + 2 * 3);
    expect(l.minutes.setup).toBe(3 * 2);
    expect(l.minutes.fastening).toBeCloseTo(100 * 0.15);
    expect(l.minutes.assembly).toBe(8 * 6);
    expect(l.minutes.handling).toBe(15);
    expect(l.totalMin).toBeCloseTo(15 + 6 + 15 + 48 + 15);
    expect(l.hours).toBeCloseTo(99 / 60);
    expect(l.costUsd).toBeCloseTo((99 / 60) * 35);
  });

  it("follows the labour standards", () => {
    const fast = custom({ labour: { screwMin: 0, setupMin: 0, handlingMin: 0, rateUsdPerHour: 60 } });
    const l = estimateLabour(bom, 100, 1, fast);
    expect(l.totalMin).toBeCloseTo(15 + 7 * 6);
    expect(l.costUsd).toBeCloseTo(((15 + 42) / 60) * 60);
  });

  it("is only handling and assembly for an empty cut list", () => {
    const l = estimateLabour([], 0, 1);
    expect(l.totalMin).toBe(15 + 7 * 6);
  });
});

describe("crateCost", () => {
  it("is wood + screws per 100 + labour", () => {
    expect(crateCost(100, 250, 40)).toEqual({ woodUsd: 100, fastenersUsd: 20, materialUsd: 120, labourUsd: 40, totalUsd: 160 });
    expect(crateCost(100, 250, 40, custom({ rates: { screwCostUsdPer100: 0 } })).totalUsd).toBe(140);
  });
});

describe("freightTerms", () => {
  it("rounds each side up to the inch, then gives volume, dim weight and density", () => {
    // 36 in exactly, 24 in + 1 mm, 20 in - 1 mm.
    const f = freightTerms(100, [914.4, 610.6, 507]);
    expect(f.outsideIn).toEqual([36, 25, 20]);
    expect(f.volumeFt3).toBeCloseTo((36 * 25 * 20) / 1728);
    expect(f.dimWeightLb).toBe(Math.ceil(18000 / 139)); // 129.5 → 130
    expect(f.dimDivisorIn3PerLb).toBe(139);
    expect(f.grossLb).toBeCloseTo(220.462);
    expect(f.densityLbFt3).toBeCloseTo(220.462 / (18000 / 1728));
    expect(f.freightClass).toBe(70); // 21.2 lb/ft³
  });

  it("uses the standard's divisor", () => {
    expect(freightTerms(100, [914.4, 914.4, 914.4], custom({ freight: { dimDivisorIn3PerLb: 166 } })).dimWeightLb).toBe(Math.ceil(46656 / 166));
  });

  it("dimensional weight is a whole lb, rounded up", () => {
    // 139 in³ exactly is 1 lb; one more inch on a side tips it over.
    expect(freightTerms(1, [139 * 25.4, 25.4, 25.4]).dimWeightLb).toBe(1);
    expect(freightTerms(1, [140 * 25.4, 25.4, 25.4]).dimWeightLb).toBe(2);
  });
});

describe("freightClassFor (NMFC 13-sub density scale)", () => {
  it.each([
    [0.5, 400],
    [1, 300],
    [1.99, 300],
    [2, 250],
    [3.99, 250],
    [4, 175],
    [6, 125],
    [8, 100],
    [9.99, 100],
    [10, 92.5],
    [12, 85],
    [14.99, 85],
    [15, 70],
    [22.49, 70],
    [22.5, 65],
    [30, 60],
    [34.99, 60],
    [35, 55],
    [49.99, 55],
    [50, 50],
    [500, 50],
  ])("%s lb/ft³ is class %s", (density, cls) => {
    expect(freightClassFor(density)).toBe(cls);
  });

  it("is class 400 for zero, negative and non-numbers", () => {
    for (const d of [0, -1, NaN, Infinity]) expect(freightClassFor(d)).toBe(400);
  });

  it("has 13 brackets, highest density first, ending at 0", () => {
    expect(NMFC_DENSITY_SCALE).toHaveLength(13);
    const mins = NMFC_DENSITY_SCALE.map((r) => r.minLbFt3);
    expect(mins).toEqual([...mins].sort((a, b) => b - a));
    expect(mins.at(-1)).toBe(0);
    expect(Object.isFrozen(NMFC_DENSITY_SCALE)).toBe(true);
  });
});

describe("the design's cost, labour and freight (spec §7.12 worked example)", () => {
  it("PART-001 × 4 with the default standards", () => {
    const d = design();
    expect(d.labour.counts).toEqual({ lumberCuts: 47, plywoodCuts: 6, cutSizes: 11, screws: 202, steps: 7 });
    expect(d.labour.totalMin).toBeCloseTo(162.55);
    expect(d.labour.costUsd).toBeCloseTo(94.82, 2);
    expect(d.cost.woodUsd).toBe(d.materialCostUsd);
    expect(d.cost.fastenersUsd).toBeCloseTo(16.16);
    expect(d.cost.totalUsd).toBeCloseTo(186.14, 2);
    expect(d.freight.outsideIn).toEqual([37, 26, 20]);
    expect(d.dimWeightLb).toBe(139);
    expect(d.densityLbFt3).toBeCloseTo(26.72, 2);
    expect(d.freightClass).toBe(65);
    expect(d.freightClass).toBe(d.freight.freightClass);
  });

  it("a labour rate change moves the labour and total cost and nothing else", () => {
    const base = design();
    const d = design("PART-001", {}, custom({ labour: { rateUsdPerHour: 70 } }));
    expect(d.labour.hours).toBe(base.labour.hours);
    expect(d.cost.labourUsd).toBeCloseTo(base.cost.labourUsd * 2);
    expect(d.cost.totalUsd - base.cost.totalUsd).toBeCloseTo(base.cost.labourUsd);
    expect(d.cost.materialUsd).toBe(base.cost.materialUsd);
    expect(d.layout.key).toBe(base.layout.key);
    expect(d.grossKg).toBe(base.grossKg);
  });

  it("a screw price change moves only the fasteners", () => {
    const base = design();
    const d = design("PART-001", {}, custom({ rates: { screwCostUsdPer100: 16 } }));
    expect(d.cost.fastenersUsd).toBeCloseTo(base.cost.fastenersUsd * 2);
    expect(d.cost.labourUsd).toBe(base.cost.labourUsd);
  });

  it("more layers add assembly steps", () => {
    expect(design("PART-001", { quantity: 8 }).labour.counts.steps).toBe(FIXED_ASSEMBLY_STEPS + 2);
  });

  it("standards saved without labour and freight load with the labour and freight defaults", () => {
    const old = { ...JSON.parse(JSON.stringify(DEFAULT_STANDARDS)) };
    delete old.labour;
    delete old.freight;
    delete old.rates.screwCostUsdPer100;
    const r = standardsFromJson(JSON.stringify({ kind: "crate-designer/shop-standards", version: 1, standards: old }));
    expect(r.ok && r.standards.labour).toEqual(DEFAULT_STANDARDS.labour);
    expect(r.ok && r.standards.freight).toEqual(DEFAULT_STANDARDS.freight);
    expect(r.ok && r.standards.rates.screwCostUsdPer100).toBe(8);
  });
});

describe("ranking option", () => {
  it("lists volume, cost and density, volume first", () => {
    expect(RANKINGS).toEqual(["volume", "cost", "density"]);
  });

  it("volume is today's ranking: nothing is designed or reordered", () => {
    const layouts = rankLayouts(getPart("PART-003"), settings({ quantity: 8 }));
    const r = rankByObjective(getPart("PART-003"), settings({ quantity: 8 }), layouts, "volume");
    expect(r.layouts).toBe(layouts);
    expect(r.designs.size).toBe(0);
    for (const id of ["PART-001", "PART-002", "PART-003"]) {
      expect(computeDesign(getPart(id), settings(), null, DEFAULT_STANDARDS, "volume")).toEqual(computeDesign(getPart(id), settings()));
    }
  });

  it("cost puts the cheapest stable, blocked crate first", () => {
    for (const [id, q] of [
      ["PART-001", 50],
      ["PART-003", 4],
      ["PART-003", 50],
    ] as const) {
      const r = computeDesign(getPart(id), settings({ quantity: q, keepUpright: false }), null, DEFAULT_STANDARDS, "cost");
      const scores = scoreLayouts(getPart(id), settings({ quantity: q, keepUpright: false }), r.layouts);
      const ok = r.layouts.filter((l) => l.stable);
      const cheapest = Math.min(...ok.map((l) => scores.get(l.key)!.costUsd));
      expect(r.design!.layout.stable).toBe(true);
      expect(r.design!.cost.totalUsd).toBeCloseTo(cheapest, 1);
      expect(r.design!.checks.find((c) => c.id === "blocking")!.level).toBe("ok");
    }
  });

  it("cost never recommends a dearer crate than volume, from the same layouts", () => {
    const part = getPart("PART-001");
    const byVolume = computeDesign(part, settings({ quantity: 40 }));
    const byCost = computeDesign(part, settings({ quantity: 40 }), null, DEFAULT_STANDARDS, "cost");
    expect(byCost.design!.cost.totalUsd).toBeLessThanOrEqual(byVolume.design!.cost.totalUsd);
    expect(byCost.layouts.map((l) => l.key).sort()).toEqual(byVolume.layouts.map((l) => l.key).sort());
  });

  it("density puts the lowest class, then the lightest, first, and avoids the LTL length charge", () => {
    const part = getPart("PART-003");
    const s30 = settings({ quantity: 30 });
    // By volume, 30 housings get a 2475 mm crate: over the 2438 mm LTL length.
    expect(computeDesign(part, s30).design!.checks.some((c) => c.id === "oversize")).toBe(true);
    const r = computeDesign(part, s30, null, DEFAULT_STANDARDS, "density");
    const d = r.design!;
    expect(d.layout.stable).toBe(true);
    expect(d.checks.some((c) => c.id === "oversize")).toBe(false);
    const eligible = r.layouts
      .map((l) => computeDesign(part, s30, l.key).design!)
      .filter((o) => o.layout.stable && !o.checks.some((c) => c.id === "oversize") && o.checks.find((c) => c.id === "blocking")!.level === "ok");
    expect(Math.min(...eligible.map((o) => o.freightClass))).toBe(d.freightClass);
    const sameClass = eligible.filter((o) => o.freightClass === d.freightClass);
    expect(Math.min(...sameClass.map((o) => Math.round(o.freight.grossLb)))).toBe(Math.round(d.freight.grossLb));
  });

  it("never trades stability for cost: an unstable layout never beats a stable one", () => {
    const part = getPart("PART-002");
    for (const ranking of ["cost", "density"] as const) {
      const r = computeDesign(part, settings({ quantity: 8, keepUpright: false, maxLayers: 4 }), null, DEFAULT_STANDARDS, ranking);
      const firstUnstable = r.layouts.findIndex((l) => !l.stable);
      if (firstUnstable >= 0) expect(r.layouts.slice(firstUnstable).every((l) => !l.stable)).toBe(true);
    }
  });

  it("explainLayout says how the recommendation was ranked", () => {
    const r = computeDesign(getPart("PART-001"), settings(), null, DEFAULT_STANDARDS, "cost");
    expect(explainLayout(r.layouts, r.design!.layout, DEFAULT_STANDARDS, "cost")).toEqual({ kind: "ranked", by: "cost" });
    expect(explainLayout(r.layouts, r.layouts[1], DEFAULT_STANDARDS, "cost").kind).toBe("picked");
  });

  it("shipment planning re-ranks each crate type and keeps the per-crate limits", () => {
    const part = getPart("PART-001");
    const byVolume = planShipment(part, settings({ quantity: 200 }));
    const byCost = planShipment(part, settings({ quantity: 200 }), null, DEFAULT_STANDARDS, "cost");
    expect(byCost.crates.map((c) => [c.count, c.quantity])).toEqual(byVolume.crates.map((c) => [c.count, c.quantity]));
    for (const c of byCost.crates) {
      expect(c.result.design!.grossKg).toBeLessThanOrEqual(DEFAULT_STANDARDS.limits.perCrate.maxGrossKg);
      expect(c.result.design!.checks.find((x) => x.id === "door")!.level).toBe("ok");
    }
    expect(byCost.totals.costUsd).toBeLessThanOrEqual(byVolume.totals.costUsd + 0.01);
  });
});

describe("shipment totals", () => {
  it("sum every crate's cost, labour and dim weight", () => {
    const plan = planShipment(getPart("PART-001"), settings({ quantity: 200 }));
    const sum = (f: (d: NonNullable<(typeof plan.crates)[0]["result"]["design"]>) => number) =>
      plan.crates.reduce((n, c) => n + c.count * f(c.result.design!), 0);
    expect(plan.split).toBe(true);
    expect(plan.totals.costUsd).toBeCloseTo(sum((d) => d.cost.totalUsd));
    expect(plan.totals.labourHours).toBeCloseTo(sum((d) => d.labour.hours));
    expect(plan.totals.dimWeightLb).toBe(sum((d) => d.dimWeightLb));
  });
});
