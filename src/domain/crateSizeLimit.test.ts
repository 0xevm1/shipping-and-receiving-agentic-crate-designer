import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { computeDesign } from "./design";
import { parseStandards, standardsFromJson, standardsToJson, DEFAULT_STANDARDS, type ShopStandards } from "./standards";
import { planShipment, sizeLimitText, sizeOverSides, withinOutsideLimits, withinSizeLimit } from "./shipment";
import { hardFailure, planTotal, sweepQuantities } from "./sweep";
import { custom, metricText, settings } from "./testFixtures";

/** The per-crate size limit (#108): `limits.perCrate.maxOutsideMm`, 0 on a side = no limit there. */

const limit = (length: number, width: number, height: number) => custom({ limits: { perCrate: { maxOutsideMm: { length, width, height } } } });
const PALLET = limit(1000, 700, 700);
const part = getPart("PART-001");

describe("withinSizeLimit", () => {
  it("is always true with the default (no limit)", () => {
    expect(withinSizeLimit([9000, 9000, 9000], DEFAULT_STANDARDS)).toBe(true);
  });

  it("lets length and width swap (a crate can be turned on the pallet), never height", () => {
    const s = limit(1200, 1000, 1000);
    expect(withinSizeLimit([1200, 1000, 1000], s)).toBe(true);
    expect(withinSizeLimit([1000, 1200, 1000], s)).toBe(true);
    expect(withinSizeLimit([1201, 900, 900], s)).toBe(false);
    expect(withinSizeLimit([1100, 1100, 900], s)).toBe(false);
    // Height is never swapped with the floor sides: a crate 1,200 tall can't stand where 1,000 is the limit.
    expect(withinSizeLimit([900, 900, 1200], s)).toBe(false);
    expect(withinSizeLimit([1200, 900, 1000], limit(1000, 1200, 1000))).toBe(true);
  });

  it("treats a 0 side as unlimited, so a height-only limit is a plain height limit", () => {
    const s = limit(0, 0, 1000);
    expect(withinSizeLimit([5000, 5000, 1000], s)).toBe(true);
    expect(withinSizeLimit([100, 100, 1001], s)).toBe(false);
    // With one floor side limited, the crate is turned to fit under it.
    expect(withinSizeLimit([2000, 600, 500], limit(0, 700, 0))).toBe(true);
    expect(withinSizeLimit([2000, 800, 500], limit(0, 700, 0))).toBe(false);
  });

  it("is part of the outside limits next to the trailer", () => {
    expect(withinOutsideLimits([1000, 700, 700], PALLET)).toBe(true);
    expect(withinOutsideLimits([1000, 701, 701], PALLET)).toBe(false);
    expect(withinOutsideLimits([20000, 700, 700], DEFAULT_STANDARDS)).toBe(false);
  });
});

describe("planShipment under a size limit", () => {
  it("leaves a batch alone while one crate is within the limit", () => {
    const plan = planShipment(part, settings({ quantity: 3 }), null, PALLET);
    expect(plan.split).toBe(false);
    expect(withinSizeLimit(plan.crates[0].result.design!.layout.external, PALLET)).toBe(true);
  });

  it("splits a batch that can't fit one crate under the limit, every crate within it", () => {
    const plan = planShipment(part, settings({ quantity: 34 }), null, PALLET);
    expect(plan.split).toBe(true);
    expect(plan.unmet).toBeNull();
    expect(plan.totals.parts).toBe(34);
    for (const c of plan.crates) {
      expect(withinSizeLimit(c.result.design!.layout.external, PALLET)).toBe(true);
      // The Layouts tab offers only layouts within the limit.
      for (const l of c.result.layouts) expect(withinSizeLimit(l.external, PALLET)).toBe(true);
    }
    const check = plan.crates[0].result.design!.checks.find((c) => c.id === "crate-limit")!;
    expect(check.level).toBe("ok");
    // The crate-limit check names the size limit with the weight limit.
    expect(metricText(check.detail)).toContain("1,000 mm × 700 mm × 700 mm outside");
    expect(metricText(check.detail)).toContain("1,000 kg gross");
  });

  it("doesn't offer layouts over the limit for a single crate either", () => {
    const s = limit(0, 0, 500);
    const { layouts } = computeDesign(part, settings({ quantity: 2 }), null, s);
    const plan = planShipment(part, settings({ quantity: 2 }), null, s);
    expect(layouts.some((l) => l.external[2] > 500)).toBe(true); // the unfiltered set has some
    expect(plan.crates[0].result.layouts.length).toBeGreaterThan(0);
    for (const l of plan.crates[0].result.layouts) expect(l.external[2]).toBeLessThanOrEqual(500);
  });

  it("says so when one part alone is over the limit, as the weight limit does", () => {
    const tiny = limit(600, 400, 400);
    const plan = planShipment(part, settings({ quantity: 3 }), null, tiny);
    expect(plan.crates).toMatchObject([{ count: 3, quantity: 1 }]);
    expect(plan.unmet).not.toBeNull();
    const text = metricText(plan.unmet!);
    expect(text).toContain("One part alone is over the per-crate limit");
    expect(text).toContain("600 mm × 400 mm × 400 mm outside");
    const check = plan.crates[0].result.design!.checks.find((c) => c.id === "crate-limit")!;
    expect(check.level).toBe("caution");
  });

  it("flags one part over the limit at quantity 1 as it does at quantity 2 (#144), naming the side", () => {
    const tiny = limit(600, 400, 400);
    for (const quantity of [1, 2]) {
      const plan = planShipment(part, settings({ quantity }), null, tiny);
      expect(plan.crates).toMatchObject([{ count: quantity, quantity: 1 }]);
      const check = plan.crates[0].result.design!.checks.find((c) => c.id === "crate-limit")!;
      expect(check.level).toBe("caution");
      const text = metricText(check.detail);
      expect(text).toContain("over the per-crate limit");
      expect(text).toContain("600 mm × 400 mm × 400 mm outside");
      expect(text).toMatch(/height \(\d[\d,]* mm against 400 mm\) is over the size limit/);
    }
  });

  it("names only the side that is over, with length and width turned to fit", () => {
    const external = [1000, 700, 900] as const;
    expect(sizeOverSides([...external], limit(700, 1000, 1000))).toEqual([]);
    expect(sizeOverSides([...external], limit(0, 0, 800))).toEqual([{ side: "height", mm: 900, maxMm: 800 }]);
    // Turned, the 700 side takes the 900 length limit and only the 1,000 side is over the 600 width.
    expect(sizeOverSides([...external], limit(900, 600, 0))).toEqual([{ side: "width", mm: 1000, maxMm: 600 }]);
  });

  it("leaves a single part that is within the limit with no crate-limit check", () => {
    const plan = planShipment(part, settings({ quantity: 1 }), null, limit(5000, 5000, 5000));
    expect(plan.unmet).toBeNull();
    expect(plan.crates[0].result.design!.checks.some((c) => c.id === "crate-limit")).toBe(false);
  });

  it("names the limit in the check as typed quantities, so the units toggle applies", () => {
    const plan = planShipment(part, settings({ quantity: 34 }), null, PALLET);
    const detail = plan.crates[0].result.design!.checks.find((c) => c.id === "crate-limit")!.detail;
    expect(detail.some((p) => typeof p === "object" && p.kind === "length" && p.mm === 1000)).toBe(true);
    expect(sizeLimitText(DEFAULT_STANDARDS)).toBeNull();
  });
});

describe("the sweep and the total split under a size limit", () => {
  const sweep = sweepQuantities(part, settings(), PALLET);

  it("never recommends a quantity whose crate is over the limit", () => {
    const unlimited = sweepQuantities(part, settings());
    expect(unlimited.recommendation!.quantity).toBeGreaterThan(sweep.recommendation!.quantity);
    expect(sweep.recommendation!.stoppedBy).toMatchObject({ binding: "max-size" });
    expect(metricText(sweep.recommendation!.stoppedBy!.reason)).toContain("over the shop's size limit");
    for (const p of sweep.shortlist) {
      const d = planShipment(part, settings({ quantity: p.quantity }), p.crate!.layoutKey, PALLET).crates[0].result.design!;
      expect(withinSizeLimit(d.layout.external, PALLET)).toBe(true);
    }
    for (const p of sweep.curve.filter((x) => x.ok)) expect(p.crate!.layoutKey).toBeTruthy();
  });

  it("reports a quantity that only fails the size limit as max-size", () => {
    const point = sweep.curve.find((p) => !p.ok)!;
    expect(point.binding).toBe("max-size");
    const d = planShipment(part, settings({ quantity: 1 }), null, DEFAULT_STANDARDS).crates[0].result.design!;
    expect(hardFailure(d, 1, limit(250, 250, 250))).toMatchObject({ binding: "max-size" });
    expect(hardFailure(d, 1, DEFAULT_STANDARDS)).toBeNull();
  });

  it("fails quantity 1 on the size limit too: no recommendation, no total split, 'none recommended'", () => {
    const tiny = sweepQuantities(part, settings(), limit(600, 400, 400));
    expect(tiny.curve[0]).toMatchObject({ quantity: 1, ok: false, binding: "max-size" });
    expect(metricText(tiny.curve[0].reason!)).toMatch(/on the (height|length|width)/);
    expect(tiny.curve.every((p) => !p.ok)).toBe(true);
    expect(tiny.recommendation).toBeNull();
    expect(tiny.shortlist).toEqual([]);
    expect(planTotal(tiny, 5)).toBeNull();
  });

  it("splits a total with every crate at a passing, within-limit quantity", () => {
    for (const total of [40, 41, 97]) {
      const plan = planTotal(sweep, total)!;
      expect(plan.types.reduce((n, t) => n + t.count * t.quantity, 0)).toBe(total);
      for (const t of plan.types) {
        expect(sweep.curve[t.quantity - 1].ok).toBe(true);
        const d = planShipment(part, settings({ quantity: t.quantity }), t.crate.layoutKey, PALLET).crates[0].result.design!;
        expect(withinSizeLimit(d.layout.external, PALLET)).toBe(true);
      }
    }
    // Without the limit 40 ships in two crates of 20; with it, in smaller crates.
    expect(planTotal(sweepQuantities(part, settings()), 40)!.perCrate).toBeGreaterThan(planTotal(sweep, 40)!.perCrate);
  });
});

describe("the standard itself", () => {
  const withField = (v: unknown) => ({
    ...DEFAULT_STANDARDS,
    limits: { ...DEFAULT_STANDARDS.limits, perCrate: { ...DEFAULT_STANDARDS.limits.perCrate, maxOutsideMm: v } },
  });

  it("defaults to no limit", () => {
    expect(DEFAULT_STANDARDS.limits.perCrate.maxOutsideMm).toEqual({ length: 0, width: 0, height: 0 });
  });

  it("reads standards saved before the field existed as no limit", () => {
    const old = structuredClone(DEFAULT_STANDARDS) as unknown as { limits: { perCrate: Record<string, unknown> } };
    delete old.limits.perCrate.maxOutsideMm;
    const r = parseStandards(old);
    expect(r.ok && r.standards.limits.perCrate.maxOutsideMm).toEqual({ length: 0, width: 0, height: 0 });
    const file = standardsFromJson(JSON.stringify({ limits: { perCrate: { maxGrossKg: 800, maxParts: 0 } } }));
    expect(file.ok && file.standards.limits.perCrate).toEqual({ maxGrossKg: 800, maxParts: 0, maxOutsideMm: { length: 0, width: 0, height: 0 } });
  });

  it("accepts a partial limit and round-trips through the file", () => {
    const s = limit(1200, 0, 1000);
    expect(s.limits.perCrate.maxOutsideMm).toEqual({ length: 1200, width: 0, height: 1000 });
    const back = standardsFromJson(standardsToJson(s));
    expect(back.ok && back.standards.limits.perCrate.maxOutsideMm).toEqual({ length: 1200, width: 0, height: 1000 });
  });

  it.each<[string, unknown]>([
    ["a negative side", { length: -5, width: 0, height: 0 }],
    ["an implausibly small side", { length: 50, width: 0, height: 0 }],
    ["an implausibly large side", { length: 0, width: 31000, height: 0 }],
    ["NaN", { length: 0, width: 0, height: NaN }],
    ["a string", { length: "1200", width: 0, height: 0 }],
  ])("rejects %s", (_name, v) => {
    const r = parseStandards(withField(v) as ShopStandards);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toContain("maxOutsideMm");
  });
});
