import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { computeDesign, DEFAULT_SETTINGS, explainLayout, settingsFromStandards, type DesignPart } from "./design";
import type { CrateSettings } from "./schema";
import {
  DEFAULT_STANDARDS,
  mergeStandards,
  minInteriorMm,
  parseStandards,
  sameStandards,
  ShopStandardsSchema,
  standardsFromJson,
  standardsToJson,
  type DeepPartial,
  type ShopStandards,
} from "./standards";
import { custom, metricText as metric } from "./testFixtures";

const design = (partId: string, standards: ShopStandards, patch: Partial<CrateSettings> = {}) =>
  computeDesign(getPart(partId), { ...DEFAULT_SETTINGS, ...patch }, null, standards).design!;

const check = (d: { checks: { id: string; level: string }[] }, id: string) => d.checks.find((c) => c.id === id);

describe("ShopStandardsSchema", () => {
  it("accepts the shipped defaults", () => {
    expect(ShopStandardsSchema.safeParse(DEFAULT_STANDARDS).success).toBe(true);
  });

  it("holds the shipped default values", () => {
    const s = DEFAULT_STANDARDS;
    expect(s.stock.cleatMm).toEqual({ thick: 19, wide: 89 });
    expect(s.stock.skidMm).toEqual({ standard: { wide: 89, tall: 89 }, heavy: { wide: 89, tall: 140 } });
    expect(s.stock.floorPlywoodMm).toBe(19);
    expect(s.stock.panelPlywoodMm).toEqual({ light: 12, medium: 15, heavy: 19 });
    expect(s.stock.blockWidthMm).toBe(89);
    expect(s.defaults).toEqual({ partGapMm: 50, wallClearanceMm: 50, maxLayers: 2, volumeTolerance: 0.03 });
    expect(s.construction).toEqual({
      panelLightMaxKg: 150,
      panelMediumMaxKg: 500,
      heavySkidOverKg: 700,
      skidSpacingMm: 800,
      maxCleatSpacingMm: 600,
      minBlockingGapMm: 19,
    });
    expect(s.limits).toMatchObject({ ltlExcessiveLengthMm: 2438, stackKg: 100, stableHeightRatio: 1.5, lowUtilization: 0.25 });
    expect(s.limits.perCrate).toEqual({ maxGrossKg: 1000, maxParts: 0 });
    expect(s.rates).toEqual({
      densityKgM3: { plywood: 600, lumber: 480 },
      costUsdPerM3: { plywood: 1100, lumber: 650 },
      screwSpacingMm: { cleat: 150, skid: 300, panelJoint: 200 },
      screwCostUsdPer100: 8,
    });
    // Labour and freight terms.
    expect(s.labour).toEqual({
      rateUsdPerHour: 35,
      lumberCutMin: 0.75,
      plywoodCutMin: 3,
      setupMin: 2,
      screwMin: 0.15,
      assemblyStepMin: 6,
      handlingMin: 15,
    });
    expect(s.freight).toEqual({ dimDivisorIn3PerLb: 139 });
    // Structural sizing, SPF No. 2 allowable stresses.
    expect(s.stock.joistMm).toEqual({ thick: 38, wide: 89 });
    expect(s.structure).toEqual({
      lumberBendingMPa: 7.8,
      lumberShearMPa: 0.93,
      lumberBearingMPa: 2.93,
      plywoodBendingMPa: 6,
      loadFactor: 1.5,
      supportLengthMm: 100,
      minForkOpeningMm: 200,
      joistOverKg: 450,
      maxJoistSpacingMm: 400,
      lidStackKg: 0,
    });
    // The fixed 1,000 kg base rating is gone: the base is rated from its members.
    expect("baseRatingKg" in s.limits).toBe(false);
  });

  it("derives the smallest interior and the default settings from the defaults", () => {
    expect(minInteriorMm(DEFAULT_STANDARDS)).toBe(178);
    expect(DEFAULT_SETTINGS).toEqual(settingsFromStandards(DEFAULT_STANDARDS));
  });

  it("can't be changed in place", () => {
    expect(() => {
      (DEFAULT_STANDARDS.rates.costUsdPerM3 as { plywood: number }).plywood = 1;
    }).toThrow();
  });

  it.each<[string, DeepPartial<ShopStandards>]>([
    ["a negative cost", { rates: { costUsdPerM3: { plywood: -1 } } }],
    ["NaN density", { rates: { densityKgM3: { lumber: NaN } } }],
    ["a string", { stock: { floorPlywoodMm: "19" as unknown as number } }],
    ["a gap over the settings range", { defaults: { partGapMm: 301 } }],
    ["a fractional layer count", { defaults: { maxLayers: 1.5 } }],
    ["panels out of order", { stock: { panelPlywoodMm: { light: 20 } } }],
    ["thresholds out of order", { construction: { panelLightMaxKg: 600 } }],
    ["a door wider than the trailer", { limits: { trailerMm: { doorWidth: 3000 } } }],
    ["blocking wider than two cleats", { stock: { blockWidthMm: 200 } }],
    ["a tiny cleat spacing", { construction: { maxCleatSpacingMm: 1 } }],
    ["a zero max gross per crate", { limits: { perCrate: { maxGrossKg: 0 } } }],
    ["a fractional part limit", { limits: { perCrate: { maxParts: 2.5 } } }],
    ["a negative part limit", { limits: { perCrate: { maxParts: -1 } } }],
    ["a negative labour rate", { labour: { rateUsdPerHour: -1 } }],
    ["a labour rate over $1,000/h", { labour: { rateUsdPerHour: 1001 } }],
    ["NaN minutes per screw", { labour: { screwMin: NaN } }],
    ["a negative cut time", { labour: { lumberCutMin: -0.5 } }],
    ["an hour per screw", { labour: { screwMin: 60 } }],
    ["a negative screw cost", { rates: { screwCostUsdPer100: -1 } }],
    ["a dim divisor of 0", { freight: { dimDivisorIn3PerLb: 0 } }],
    ["a dim divisor over 500", { freight: { dimDivisorIn3PerLb: 501 } }],
    ["a load factor under 1", { structure: { loadFactor: 0.9 } }],
    ["a zero bending stress", { structure: { lumberBendingMPa: 0 } }],
    ["NaN plywood stress", { structure: { plywoodBendingMPa: NaN } }],
    ["a negative stacking load", { structure: { lidStackKg: -1 } }],
    ["a tiny joist spacing", { structure: { maxJoistSpacingMm: 10 } }],
    ["a paper-thin joist", { stock: { joistMm: { thick: 1 } } }],
  ])("rejects %s", (_, patch) => {
    const r = parseStandards(mergeStandards(DEFAULT_STANDARDS, patch));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\w+: /);
  });

  it("splits a failure into the field path and the plain message", () => {
    const r = parseStandards(mergeStandards(DEFAULT_STANDARDS, { stock: { joistMm: { thick: 1 } } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.path).toBe("stock.joistMm.thick");
    expect(r.error).toBe(`${r.path}: ${r.message}`);
    expect(r.message).not.toMatch(/stock\./);
  });

  it("merges a patch deeply without touching the base", () => {
    const merged = mergeStandards(DEFAULT_STANDARDS, { rates: { costUsdPerM3: { plywood: 2000 } } }) as ShopStandards;
    expect(merged.rates.costUsdPerM3).toEqual({ plywood: 2000, lumber: 650 });
    expect(merged.rates.densityKgM3).toBe(DEFAULT_STANDARDS.rates.densityKgM3);
    expect(DEFAULT_STANDARDS.rates.costUsdPerM3.plywood).toBe(1100);
  });

  it("ignores prototype keys in a patch", () => {
    const merged = mergeStandards(DEFAULT_STANDARDS, JSON.parse('{"__proto__": {"polluted": true}}')) as object;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(sameStandards(merged as ShopStandards, DEFAULT_STANDARDS)).toBe(true);
  });
});

describe("computeDesign with custom standards", () => {
  it("defaults give the same design as passing nothing", () => {
    const a = computeDesign(getPart("PART-001"), DEFAULT_SETTINGS);
    const b = computeDesign(getPart("PART-001"), DEFAULT_SETTINGS, null, custom({}));
    expect(b).toEqual(a);
  });

  it("a lower light-panel threshold switches the plywood", () => {
    // PART-001 × 4 is 86 kg of parts: 12 mm by default.
    expect(design("PART-001", DEFAULT_STANDARDS).construction.panelMm).toBe(12);
    const d = design("PART-001", custom({ construction: { panelLightMaxKg: 50 } }));
    expect(d.construction.panelMm).toBe(15);
    expect(d.members.filter((m) => m.kind === "side").every((m) => m.size[1] === 15)).toBe(true);
  });

  it("uses the plywood on hand", () => {
    const d = design("PART-001", custom({ stock: { panelPlywoodMm: { light: 18, medium: 18, heavy: 25 } } }));
    expect(d.construction.panelMm).toBe(18);
    expect(d.bom.some((l) => l.stock === "18 mm")).toBe(true);
  });

  it("a heavy-skid threshold change picks the heavy skids", () => {
    const d = design("PART-001", custom({ construction: { heavySkidOverKg: 50 } }));
    expect(d.construction.skid).toEqual({ wide: 89, tall: 140 });
    expect(check(d, "base-rating")!).toMatchObject({ level: "ok" });
    expect(metric(d.checks.find((c) => c.id === "base-rating")!.detail)).toContain("4x6 skids");
  });

  it("a plywood rate change changes the cost and nothing else", () => {
    const base = design("PART-001", DEFAULT_STANDARDS);
    const d = design("PART-001", custom({ rates: { costUsdPerM3: { plywood: 2200 } } }));
    expect(d.materialCostUsd).toBeGreaterThan(base.materialCostUsd);
    expect(d.tareKg).toBe(base.tareKg);
    expect(d.layout.external).toEqual(base.layout.external);
    // Doubling the plywood rate adds exactly the plywood cost again.
    const plywoodCost = base.materialCostUsd - lumberCost(base);
    expect(d.materialCostUsd).toBeCloseTo(base.materialCostUsd + plywoodCost, 6);
  });

  it("a density change changes the weights", () => {
    const base = design("PART-001", DEFAULT_STANDARDS);
    const d = design("PART-001", custom({ rates: { densityKgM3: { lumber: 960 } } }));
    expect(d.tareKg).toBeGreaterThan(base.tareKg);
    expect(d.tareKgByAssembly.inside).toBeCloseTo(base.tareKgByAssembly.inside * 2, 6); // all-lumber dunnage at 1 layer
  });

  it("weaker lumber lowers the computed base rating, down to a caution", () => {
    const base = design("PART-001", DEFAULT_STANDARDS);
    expect(check(base, "base-rating")!.level).toBe("ok");
    const weaker = design("PART-001", custom({ structure: { plywoodBendingMPa: 3 } }));
    expect(weaker.structure.ratedPayloadKg).toBeLessThan(base.structure.ratedPayloadKg);
    const weak = custom({ structure: { lumberBendingMPa: 0.5, lumberShearMPa: 0.1, lumberBearingMPa: 0.5, plywoodBendingMPa: 0.5, loadFactor: 5 } });
    const d = design("PART-001", weak);
    expect(check(d, "base-rating")).toMatchObject({ level: "caution", title: "Over the base rating" });
    expect(metric(d.checks.find((c) => c.id === "base-rating")!.detail)).toMatch(/^Base rated \d+ kg; this crate's payload is 86 kg/);
  });

  it("a lower stack limit turns the stack check into a caution", () => {
    const d = design("PART-001", custom({ limits: { stackKg: 10 } }), { quantity: 8 });
    expect(d.layout.counts[2]).toBe(2);
    expect(check(d, "stack")!.level).toBe("caution");
  });

  it("a shorter trailer fails the door check, and a shorter LTL limit adds the surcharge note", () => {
    const d = design("PART-002", custom({ limits: { trailerMm: { interiorLength: 1500 }, ltlExcessiveLengthMm: 1219 } }));
    expect(check(d, "door")!.level).toBe("caution");
    expect(check(d, "oversize")).toMatchObject({ level: "info" });
    expect(metric(d.checks.find((c) => c.id === "oversize")!.detail)).toContain("(4 ft)");
  });

  it("wider minimum blocking gap removes the posts and flags it", () => {
    const d = design("PART-001", custom({ construction: { minBlockingGapMm: 60 } }));
    expect(d.members.some((m) => m.kind === "blocking")).toBe(false);
    expect(check(d, "blocking")!.level).toBe("caution");
  });

  it("tighter cleat spacing adds uprights and screws", () => {
    const base = design("PART-002", DEFAULT_STANDARDS);
    const d = design("PART-002", custom({ construction: { maxCleatSpacingMm: 300 }, rates: { screwSpacingMm: { cleat: 100 } } }));
    const uprights = (x: typeof d) => x.members.filter((m) => m.label === "Side upright").length;
    expect(uprights(d)).toBeGreaterThan(uprights(base));
    expect(d.screws).toBeGreaterThan(base.screws);
  });

  it("a wider skid spacing uses fewer skids", () => {
    const base = design("PART-003", DEFAULT_STANDARDS, { quantity: 8 });
    const d = design("PART-003", custom({ construction: { skidSpacingMm: 2000 } }), { quantity: 8 });
    expect(base.construction.skidCount).toBe(3);
    expect(d.construction.skidCount).toBe(2);
  });

  it("a bigger cleat grows the crate and its minimum interior", () => {
    const s = custom({ stock: { cleatMm: { thick: 38, wide: 140 } } });
    const d = design("PART-001", s);
    const { external, interior } = d.layout;
    expect(external[0] - interior[0]).toBe(2 * (12 + 38));
    expect(d.members.filter((m) => m.kind === "cleat").every((m) => [...m.size].sort((a, b) => a - b)[0] === 38)).toBe(true);
    const tiny: DesignPart = { id: "t", name: "Tiny", mass_kg: 1, dimensions_mm: [1, 1, 1] };
    expect(computeDesign(tiny, DEFAULT_SETTINGS, null, s).design!.layout.interior).toEqual([280, 280, 280]);
  });

  it("the stability ratio and volume tolerance steer the ranking", () => {
    const strict = custom({ limits: { stableHeightRatio: 0.5 } });
    const d = design("PART-002", strict, { quantity: 1, keepUpright: false });
    expect(check(d, "stable")!.level).toBe("caution");

    const r = computeDesign(getPart("PART-001"), DEFAULT_SETTINGS);
    const loose = custom({ defaults: { volumeTolerance: 0.5 } });
    const r2 = computeDesign(getPart("PART-001"), DEFAULT_SETTINGS, null, loose);
    expect(explainLayout(r2.layouts, r2.design!.layout, loose).kind).toBe("tie");
    expect(r.layouts.map((l) => l.key)).not.toEqual(r2.layouts.map((l) => l.key));
  });

  it("default gap, clearance and layers feed new settings", () => {
    const s = custom({ defaults: { partGapMm: 25, wallClearanceMm: 30, maxLayers: 3 } });
    expect(settingsFromStandards(s, 8)).toEqual({ ...DEFAULT_SETTINGS, quantity: 8, partGapMm: 25, wallClearanceMm: 30, maxLayers: 3 });
  });

  it("invalid standards passed straight in return a problem, not a crash", () => {
    const bad = { ...DEFAULT_STANDARDS, rates: { ...DEFAULT_STANDARDS.rates, costUsdPerM3: { plywood: -5, lumber: 650 } } };
    const r = computeDesign(getPart("PART-001"), DEFAULT_SETTINGS, null, bad);
    expect(r.design).toBeNull();
    expect(r.problem).toMatchObject({ id: "standards" });
    expect(metric(r.problem!.detail)).toContain("rates.costUsdPerM3.plywood");
  });
});

describe("standards JSON", () => {
  it("round-trips", () => {
    const s = custom({ rates: { costUsdPerM3: { lumber: 700 } } });
    const r = standardsFromJson(standardsToJson(s));
    expect(r.ok && sameStandards(r.standards, s)).toBe(true);
  });

  it("fills a partial file in from the defaults", () => {
    const r = standardsFromJson(JSON.stringify({ limits: { stackKg: 80 } }));
    expect(r.ok && r.standards.limits.stackKg).toBe(80);
    expect(r.ok && r.standards.rates).toEqual(DEFAULT_STANDARDS.rates);
  });

  it("still loads a file saved with the old fixed base rating: the old base rating is dropped, the structure filled in", () => {
    const r = standardsFromJson(JSON.stringify({ limits: { baseRatingKg: 1200, stackKg: 80 } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("baseRatingKg" in r.standards.limits).toBe(false);
    expect(r.standards.structure).toEqual(DEFAULT_STANDARDS.structure);
    expect(r.standards.limits.stackKg).toBe(80);
  });

  it.each([
    ["not JSON", "{oops", /valid JSON/],
    ["an array", "[1,2]", /doesn't hold/],
    ["another version", JSON.stringify({ kind: "crate-designer/shop-standards", version: 99, standards: {} }), /newer version.*99/],
    ["an envelope of another kind", JSON.stringify({ kind: "crate-design", version: 1, standards: {} }), /not a shop standards file/],
    ["an envelope with no kind", JSON.stringify({ version: 1, standards: {} }), /not a shop standards file/],
    [
      "an invalid value",
      JSON.stringify({ kind: "crate-designer/shop-standards", version: 1, standards: { stock: { floorPlywoodMm: 0 } } }),
      /stock\.floorPlywoodMm/,
    ],
  ])("rejects %s", (_, text, message) => {
    const r = standardsFromJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});

function lumberCost(d: { members: { material: string; size: number[] }[] }) {
  const m3 = d.members.filter((m) => m.material === "lumber").reduce((v, m) => v + (m.size[0] * m.size[1] * m.size[2]) / 1e9, 0);
  return m3 * DEFAULT_STANDARDS.rates.costUsdPerM3.lumber;
}
