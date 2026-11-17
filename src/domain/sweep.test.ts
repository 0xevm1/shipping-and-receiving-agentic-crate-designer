import { ANY_FACES } from "./orientations";
import { describe, expect, it } from "vitest";
import { getPart, parts } from "./catalog";
import { designCrate } from "./crate";
import { DEFAULT_SETTINGS, rankLayouts, type DesignPart } from "./design";
import { CrateSettingsFields } from "./schema";
import { planShipment } from "./shipment";
import { DEFAULT_STANDARDS } from "./standards";
import {
  compareSweepPoints,
  evenSplit,
  freightCostUsd,
  FreightRatesSchema,
  hardFailure,
  planTotal,
  SWEEP_LAYOUTS_PER_QUANTITY,
  SWEEP_MAX_QUANTITY,
  SWEEP_SHORTLIST_SIZE,
  sweepQuantities,
  tieBreakBetween,
  type FreightRates,
  type QuantitySweep,
  type SweepCrate,
  type SweepPoint,
} from "./sweep";
import { custom, loadAwareBudget, metricText, settings, facesFor } from "./testFixtures";

const cents = (v: number) => Math.round(v * 100);
const RATES: FreightRates = { usdPerCwtByClass: { "50": 20, "65": 30, "85": 40, "125": 60, "400": 150 }, minimumUsd: 90 };

// One sweep per sample part and keep-upright, shared by the tests that only read it.
const sweeps = parts.flatMap((p) =>
  [true, false].map((keepUpright) => ({ p, keepUpright, sweep: sweepQuantities(p, settings({ restingFaces: facesFor(keepUpright) })) })),
);

describe("sweepQuantities: the curve", () => {
  it("the maximum quantity is the quantity setting's maximum", () => {
    expect(SWEEP_MAX_QUANTITY).toBe(CrateSettingsFields.shape.quantity.maxValue);
  });

  it.each(sweeps)("$p.id (upright $keepUpright) has one point per quantity, each passing or saying why not", ({ sweep }) => {
    expect(sweep.problem).toBeNull();
    expect(sweep.curve.map((p) => p.quantity)).toEqual(Array.from({ length: SWEEP_MAX_QUANTITY }, (_, i) => i + 1));
    for (const point of sweep.curve) {
      if (point.ok) {
        expect(point.binding).toBeNull();
        expect(point.crate).not.toBeNull();
      } else {
        expect(point.binding).not.toBeNull();
        expect(metricText(point.reason!).length).toBeGreaterThan(0);
        expect(point.crate).toBeNull();
      }
    }
  });

  it("without freight rates, no freight dollars appear and the score is the crate cost per part", () => {
    for (const { sweep } of sweeps) {
      expect(sweep.basis).toBe("crate-only");
      for (const point of sweep.curve.filter((p) => p.ok)) {
        expect(point.crate!.freightUsd).toBeNull();
        expect(point.crate!.scoreUsdPerPart).toBeCloseTo(point.crate!.crateCostUsd / point.quantity, 9);
      }
      expect(metricText(sweep.recommendation!.rationale)).toContain("freight is not priced");
    }
  });

  it("each passing point is the cheapest passing crate among the layouts it designed", () => {
    const p = getPart("PART-001");
    const s = settings({ restingFaces: ANY_FACES });
    const sweep = sweepQuantities(p, s);
    for (const q of [1, 4, 12, 20]) {
      const point = sweep.curve[q - 1];
      const layout = rankLayouts(p, { ...s, quantity: q }).find((l) => l.key === point.crate!.layoutKey)!;
      const d = designCrate(p, { ...s, quantity: q }, layout);
      expect(hardFailure(d, q)).toBeNull();
      expect(point.crate!.crateCostUsd).toBeCloseTo(d.cost.totalUsd, 9);
    }
  });

  it("is deterministic: the same input gives the same JSON (so a worker and the server agree)", () => {
    const p = getPart("PART-003");
    expect(JSON.stringify(sweepQuantities(p, DEFAULT_SETTINGS))).toBe(JSON.stringify(sweepQuantities(p, DEFAULT_SETTINGS)));
  });

  it("ignores the quantity setting", () => {
    const p = getPart("PART-002");
    expect(JSON.stringify(sweepQuantities(p, settings({ quantity: 1 })))).toBe(JSON.stringify(sweepQuantities(p, settings({ quantity: 150 }))));
  });

  it("takes a smaller maximum quantity", () => {
    const sweep = sweepQuantities(getPart("PART-003"), DEFAULT_SETTINGS, DEFAULT_STANDARDS, { maxQuantity: 10 });
    expect(sweep.curve).toHaveLength(10);
    expect(sweep.recommendation!.quantity).toBeLessThanOrEqual(10);
  });

  it("returns the design problem, and no curve, for a part it can't design", () => {
    const bad: DesignPart = { id: "x", name: "Flat", mass_kg: 1, dimensions_mm: [100, 100, 0] };
    const sweep = sweepQuantities(bad, DEFAULT_SETTINGS);
    expect(sweep.problem?.id).toBe("part-size");
    expect(sweep.curve).toEqual([]);
    expect(sweep.recommendation).toBeNull();
  });
});

describe("the sweep and the shipment plan agree (§7.16, §7.10)", () => {
  // Applying a recommendation (the Rules tab's Use, a shortlist configuration) sets the quantity
  // and the layout; the plan must ship exactly that crate, once, with no split.
  it.each(sweeps)("$p.id (upright $keepUpright): the recommendation and shortlist each plan as that one crate", ({ p, keepUpright, sweep }) => {
    for (const point of [{ quantity: sweep.recommendation!.quantity, crate: sweep.recommendation!.crate }, ...sweep.shortlist]) {
      const plan = planShipment(p, settings({ restingFaces: facesFor(keepUpright), quantity: point.quantity }), point.crate!.layoutKey);
      expect(plan.split).toBe(false);
      expect(plan.totals.parts).toBe(point.quantity);
      expect(plan.crates[0].result.design!.layout.key).toBe(point.crate!.layoutKey);
      expect(plan.crates[0].result.design!.cost.totalUsd).toBeCloseTo(point.crate!.crateCostUsd, 9);
    }
  });
});

describe("sweepQuantities: hard checks filter first", () => {
  it.each(sweeps)("$p.id (upright $keepUpright): the recommendation passes every hard check and is the best score", ({ p, keepUpright, sweep }) => {
    const r = sweep.recommendation!;
    const point = sweep.curve[r.quantity - 1];
    expect(point.ok).toBe(true);
    const s = settings({ restingFaces: facesFor(keepUpright), quantity: r.quantity });
    const layout = rankLayouts(p, s).find((l) => l.key === r.crate.layoutKey)!;
    const d = designCrate(p, s, layout);
    expect(hardFailure(d, r.quantity)).toBeNull();
    expect(d.grossKg).toBeLessThanOrEqual(DEFAULT_STANDARDS.limits.perCrate.maxGrossKg);
    // Nothing passing scores lower, to the cent.
    const lowest = Math.min(...sweep.curve.filter((x) => x.ok).map((x) => cents(x.crate!.scoreUsdPerPart)));
    expect(cents(r.crate.scoreUsdPerPart)).toBe(lowest);
  });

  it.each(sweeps)("$p.id (upright $keepUpright): the rationale names the constraint that stopped a larger crate", ({ sweep }) => {
    const r = sweep.recommendation!;
    const firstFail = sweep.curve.slice(r.quantity).find((x) => !x.ok)!;
    expect(r.stoppedBy).toEqual({ quantity: firstFail.quantity, binding: firstFail.binding, reason: firstFail.reason });
    expect(metricText(r.rationale)).toContain(metricText(firstFail.reason!));
    expect(r.costLimited).toBe(sweep.curve.slice(r.quantity).some((x) => x.ok));
  });

  it("the shortlist is the best passing quantities, best first", () => {
    for (const { sweep } of sweeps) {
      expect(sweep.shortlist.length).toBe(Math.min(SWEEP_SHORTLIST_SIZE, sweep.curve.filter((x) => x.ok).length));
      expect(sweep.shortlist[0].quantity).toBe(sweep.recommendation!.quantity);
      sweep.shortlist.forEach((x) => expect(x.ok).toBe(true));
      for (let i = 1; i < sweep.shortlist.length; i++) expect(compareSweepPoints(sweep.shortlist[i - 1], sweep.shortlist[i])).toBeLessThanOrEqual(0);
    }
  });

  it("over the per-crate gross limit, a quantity fails without designing a crate", () => {
    const p = getPart("PART-002"); // 27 kg
    const sweep = sweepQuantities(p, DEFAULT_SETTINGS);
    const over = sweep.curve.filter((x) => x.quantity * p.mass_kg > DEFAULT_STANDARDS.limits.perCrate.maxGrossKg);
    expect(over.length).toBeGreaterThan(100);
    over.forEach((x) => expect(x.binding).toBe("max-gross"));
  });

  it("a part-count limit caps the recommendation", () => {
    const sweep = sweepQuantities(getPart("PART-003"), DEFAULT_SETTINGS, custom({ limits: { perCrate: { maxParts: 6 } } }));
    sweep.curve.slice(6).forEach((x) => expect(x.binding).toBe("max-parts"));
    // Crate cost per part falls with quantity here, so the limit is what stops it.
    expect(sweep.recommendation).toMatchObject({ quantity: 6, stoppedBy: { quantity: 7, binding: "max-parts" }, costLimited: false });
  });

  it("a part too long for the trailer is never recommended", () => {
    const long: DesignPart = { id: "long", name: "Long", mass_kg: 5, dimensions_mm: [17000, 200, 200] };
    const sweep = sweepQuantities(long, DEFAULT_SETTINGS, DEFAULT_STANDARDS, { maxQuantity: 5 });
    sweep.curve.forEach((x) => expect(x.binding).toBe("door"));
    expect(sweep.recommendation).toBeNull();
    expect(planTotal(sweep, 3)).toBeNull();
  });

  it("parts that can't be blocked in are never recommended", () => {
    const sweep = sweepQuantities(getPart("PART-001"), settings({ partGapMm: 0, wallClearanceMm: 0 }), DEFAULT_STANDARDS, { maxQuantity: 6 });
    sweep.curve.forEach((x) => expect(x.binding).toBe("blocking"));
    expect(sweep.recommendation).toBeNull();
  });
});

describe("freight rates", () => {
  it("price freight per crate on gross weight by class, with the minimum charge", () => {
    expect(freightCostUsd(1000, 65, RATES)).toBe(300); // 10 cwt × $30
    expect(freightCostUsd(1000, 70, RATES)).toBe(400); // no 70: the next higher class, 85
    expect(freightCostUsd(1000, 500, RATES)).toBe(1500); // above the table: the highest class
    expect(freightCostUsd(100, 50, RATES)).toBe(90); // $20 is under the $90 minimum
  });

  it("are validated", () => {
    expect(FreightRatesSchema.safeParse({ usdPerCwtByClass: {} }).success).toBe(false);
    expect(FreightRatesSchema.safeParse({ usdPerCwtByClass: { "65": -1 } }).success).toBe(false);
    expect(FreightRatesSchema.safeParse({ usdPerCwtByClass: { class65: 1 } }).success).toBe(false);
    expect(() => sweepQuantities(getPart("PART-001"), DEFAULT_SETTINGS, DEFAULT_STANDARDS, { freightRates: { usdPerCwtByClass: {} } })).toThrow();
  });

  it("add freight to the score when given", () => {
    const sweep = sweepQuantities(getPart("PART-001"), DEFAULT_SETTINGS, DEFAULT_STANDARDS, { freightRates: RATES });
    expect(sweep.basis).toBe("crate-and-freight");
    for (const x of sweep.curve.filter((c) => c.ok)) {
      const c = x.crate!;
      expect(c.freightUsd).toBeCloseTo(freightCostUsd(c.grossLb, c.freightClass, RATES), 9);
      expect(c.scoreUsdPerPart).toBeCloseTo((c.crateCostUsd + c.freightUsd!) / x.quantity, 9);
    }
    expect(metricText(sweep.recommendation!.rationale)).toContain("crate and freight cost");
  });
});

describe("ties", () => {
  const crate = (score: number, density: number): SweepCrate => ({
    layoutKey: "k",
    crateCostUsd: score,
    cost: { woodUsd: score, fastenersUsd: 0, screws: 0, labourUsd: 0, buildMin: 0 },
    freightUsd: null,
    scoreUsdPerPart: score,
    grossKg: 1,
    grossLb: 1,
    volumeFt3: 1,
    densityLbFt3: density,
    freightClass: 100,
    externalVolumeM3: 1,
  });
  const point = (quantity: number, score: number, density = 10): SweepPoint => ({
    quantity,
    ok: true,
    binding: null,
    reason: null,
    crate: crate(score, density),
    layoutsDesigned: 1,
    layoutsPassed: 1,
  });

  it("go to the lower cost per part, to the cent", () => {
    expect(compareSweepPoints(point(4, 10.0), point(8, 10.02))).toBeLessThan(0);
  });
  it("then to fewer crates (more parts each)", () => {
    expect(compareSweepPoints(point(8, 10.001), point(4, 10.004))).toBeLessThan(0);
  });
  it("then to denser freight", () => {
    expect(compareSweepPoints(point(4, 10, 20), point(4, 10, 12))).toBeLessThan(0);
  });
  it("are reported on the recommendation only when the tie-break decided it", () => {
    expect(tieBreakBetween(point(4, 10.0), point(8, 10.02))).toBeNull();
    expect(tieBreakBetween(point(8, 10.001), point(4, 10.004))).toBe("fewer-crates");
    expect(tieBreakBetween(point(4, 10, 20), point(4, 10, 12))).toBe("denser-freight");
    expect(tieBreakBetween(point(4, 10), undefined)).toBeNull();
  });
  it("PART-003 lying down: 42 and 36 per crate cost the same to the cent, so 42 (fewer crates) wins", () => {
    const rec = sweepQuantities(getPart("PART-003"), settings({ restingFaces: ANY_FACES })).recommendation!;
    expect(rec.quantity).toBe(42);
    expect(rec.tieBreak).toBe("fewer-crates");
  });
});

describe("what the curve records for explaining it (§7.16)", () => {
  it.each(sweeps)("$p.id (upright $keepUpright): the cost breakdown adds up and the layout counts are bounded", ({ sweep }) => {
    for (const point of sweep.curve) {
      expect(point.layoutsPassed).toBeLessThanOrEqual(point.layoutsDesigned);
      expect(point.layoutsDesigned).toBeLessThanOrEqual(SWEEP_LAYOUTS_PER_QUANTITY);
      if (point.ok) {
        const c = point.crate!.cost;
        expect(point.layoutsPassed).toBeGreaterThan(0);
        expect(c.woodUsd + c.fastenersUsd + c.labourUsd).toBeCloseTo(point.crate!.crateCostUsd, 9);
        expect(c.screws).toBeGreaterThan(0);
        expect(c.buildMin).toBeGreaterThan(0);
      } else expect(point.layoutsPassed).toBe(0);
    }
    // Over the gross limit on the parts alone: failed without designing.
    expect(sweep.curve[SWEEP_MAX_QUANTITY - 1].layoutsDesigned).toBe(0);
  });
});

describe("total-quantity mode (planTotal)", () => {
  it("evenSplit gives crate sizes that differ by at most one and add up to the total", () => {
    for (const [n, c] of [
      [10, 3],
      [7, 7],
      [200, 6],
      [1, 1],
      [33, 4],
    ]) {
      const split = evenSplit(n, c);
      expect(split.reduce((s, t) => s + t.count, 0)).toBe(c);
      expect(split.reduce((s, t) => s + t.count * t.quantity, 0)).toBe(n);
      const qs = split.map((t) => t.quantity);
      expect(Math.max(...qs) - Math.min(...qs)).toBeLessThanOrEqual(1);
    }
    expect(evenSplit(10, 3)).toEqual([
      { quantity: 4, count: 1 },
      { quantity: 3, count: 2 },
    ]);
  });

  it.each([1, 7, 33, 100, 500, 1000, 4321])("with total %i, crates × quantity covers it, every crate passes, and none holds under half the others", (total) => {
    for (const { sweep } of sweeps) {
      const plan = planTotal(sweep, total)!;
      expect(plan.types.reduce((s, t) => s + t.count * t.quantity, 0)).toBe(total);
      expect(plan.crates * plan.perCrate).toBeGreaterThanOrEqual(total);
      expect(plan.types.reduce((s, t) => s + t.count, 0)).toBe(plan.crates);
      const qs = plan.types.map((t) => t.quantity);
      expect(Math.min(...qs)).toBeGreaterThanOrEqual(Math.max(...qs) / 2);
      plan.types.forEach((t) => expect(sweep.curve[t.quantity - 1].ok).toBe(true));
      expect(plan.freightUsd).toBeNull();
      expect(plan.scoreUsdPerPart).toBeCloseTo(plan.crateCostUsd / total, 9);
    }
  });

  it("never needs more crates than parts, and uses one crate when that is cheapest", () => {
    const sweep = sweeps[0].sweep;
    const r = sweep.recommendation!.quantity;
    expect(planTotal(sweep, r)).toMatchObject({ crates: 1, perCrate: r });
  });

  it("on a tie in cost per part, takes fewer crates", () => {
    // A flat curve: every quantity costs $10 a part.
    const flat: QuantitySweep = {
      basis: "crate-only",
      maxQuantity: 10,
      candidates: null,
      curve: Array.from({ length: 10 }, (_, i) => ({
        quantity: i + 1,
        ok: true,
        binding: null,
        reason: null,
        crate: { ...sweeps[0].sweep.recommendation!.crate, crateCostUsd: 10 * (i + 1), scoreUsdPerPart: 10 },
        layoutsDesigned: 1,
        layoutsPassed: 1,
      })),
      shortlist: [],
      recommendation: null,
      problem: null,
    };
    expect(planTotal(flat, 25)).toMatchObject({ crates: 3, perCrate: 9 });
  });

  it("is null when the total can't be planned", () => {
    expect(planTotal(sweeps[0].sweep, 0)).toBeNull();
    expect(planTotal(sweeps[0].sweep, Number.NaN)).toBeNull();
  });
});

describe("speed", () => {
  it("sweeps 1–200 for every sample part fast enough for a Web Worker", () => {
    // Measured at 30–125 ms per part on an M-series Mac. The budget is generous and grows with
    // the machine's load (#48), so it catches a 10× regression without failing a busy commit hook.
    const budget = loadAwareBudget(1500, 400);
    for (const p of parts) {
      const t0 = performance.now();
      sweepQuantities(p, settings({ restingFaces: ANY_FACES }));
      expect(performance.now() - t0).toBeLessThan(budget);
    }
  });
});
