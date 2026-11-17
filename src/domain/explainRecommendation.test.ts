import { ANY_FACES, AS_MODELLED_FACES } from "./orientations";
import { describe, expect, it } from "vitest";
import { getPart, parts } from "./catalog";
import { explainRecommendation, quantityRuns, type RecommendationExplanation } from "./explainRecommendation";
import { PLACEHOLDER_COST_NOTE } from "./standards";
import { sweepQuantities, type FreightRates, type QuantitySweep } from "./sweep";
import { custom, metricText, settings, facesFor } from "./testFixtures";

const RATES: FreightRates = { usdPerCwtByClass: { "50": 20, "65": 30, "85": 40, "125": 60, "400": 150 }, minimumUsd: 90 };

/** Every sample part, upright and not, with and without freight rates. */
const cases = parts.flatMap((p) =>
  [true, false].flatMap((keepUpright) =>
    [null, RATES].map((rates) => {
      const s = settings({ restingFaces: facesFor(keepUpright) });
      const sweep = sweepQuantities(p, s, undefined, { freightRates: rates });
      return { id: p.id, keepUpright, rates: !!rates, s, sweep, e: explainRecommendation(sweep, undefined, s)! };
    }),
  ),
);
const find = (id: string, keepUpright: boolean, rates = false) => cases.find((c) => c.id === id && c.keepUpright === keepUpright && c.rates === rates)!;

const text = (e: RecommendationExplanation, id: string) =>
  e.sections
    .find((s) => s.id === id)!
    .lines.map(metricText)
    .join("\n");

describe("explainRecommendation: from the sweep's own numbers (§7.16)", () => {
  it.each(cases)("$id upright $keepUpright, rates $rates: five sections, in order", ({ e }) => {
    expect(e.sections.map((s) => s.id)).toEqual(["compared", "score", "pick", "limit", "considerations"]);
    for (const s of e.sections) expect(s.lines.length).toBeGreaterThan(0);
  });

  it.each(cases)("$id upright $keepUpright, rates $rates: the pick and its score are the sweep's", ({ e, sweep }) => {
    const rec = sweep.recommendation!;
    expect(e.quantity).toBe(rec.quantity);
    expect(e.layoutKey).toBe(rec.crate.layoutKey);
    expect(e.ranking.map((r) => r.quantity)).toEqual(sweep.shortlist.map((p) => p.quantity));
    expect(e.ranking[0]).toMatchObject({ picked: true, vsPickUsdPerPart: 0 });
    for (const r of e.ranking.slice(1)) expect(r.vsPickUsdPerPart).toBeGreaterThan(-0.005);
    expect(metricText(e.headline)).toContain(`${rec.quantity} per crate`);
    expect(metricText(e.headline)).toContain(`$${rec.crate.scoreUsdPerPart.toFixed(2)}`);
  });

  it.each(cases)("$id upright $keepUpright, rates $rates: what was compared is counted from the curve", ({ e, sweep }) => {
    const passing = sweep.curve.filter((p) => p.ok).length;
    const compared = text(e, "compared");
    expect(compared).toContain(`from 1 to ${sweep.maxQuantity}`);
    expect(compared).toContain(`${passing} quantities passed`);
    expect(compared).toContain(`${sweep.maxQuantity - passing} quantities failed`);
    expect(compared).toContain(`${sweep.curve.reduce((n, p) => n + p.layoutsDesigned, 0)} crates in all`);
  });

  it.each(cases)("$id upright $keepUpright, rates $rates: the cost lines add up to the score", ({ e, sweep, rates }) => {
    const crate = sweep.recommendation!.crate;
    const [wood, fasteners, labour, total, freight, perPart] = e.costLines;
    expect(wood.usd! + fasteners.usd! + labour.usd!).toBeCloseTo(total.usd!, 9);
    expect(total.usd).toBeCloseTo(crate.crateCostUsd, 9);
    expect(perPart.usd).toBeCloseTo((crate.crateCostUsd + (freight.usd ?? 0)) / e.quantity, 9);
    if (rates) expect(freight.usd).toBe(crate.freightUsd);
    else expect(freight.usd).toBeNull();
  });

  it.each(cases.filter((c) => !c.rates))("$id upright $keepUpright: without rates, freight is not priced and no freight dollars appear", ({ e }) => {
    expect(e.basis).toBe("crate-only");
    expect(text(e, "score")).toContain("Freight is not priced");
    expect(text(e, "score")).not.toMatch(/\$[\d.,]+ freight/);
    expect(e.ranking.every((r) => r.freightUsd === null)).toBe(true);
  });

  it.each(cases.filter((c) => c.rates))("$id upright $keepUpright: with rates, freight is priced into the score", ({ e }) => {
    expect(e.basis).toBe("crate-and-freight");
    expect(text(e, "score")).toMatch(/\$[\d.,]+ freight/);
    expect(e.costLines[4].usd).toBeGreaterThan(0);
  });

  it("says when the costs are the shipped placeholders, and not when the shop entered its own", () => {
    const { e, s } = find("PART-001", true);
    expect(e.placeholderCosts).toBe(true);
    expect(text(e, "score")).toContain(PLACEHOLDER_COST_NOTE);
    const own = custom({
      rates: { screwCostUsdPer100: 9, costUsdPerM3: { plywood: 1200, lumber: 700 } },
      labour: { rateUsdPerHour: 40, lumberCutMin: 1, plywoodCutMin: 4, setupMin: 3, screwMin: 0.2, assemblyStepMin: 7, handlingMin: 20 },
    });
    const mine = explainRecommendation(sweepQuantities(getPart("PART-001"), s, own), own, s)!;
    expect(mine.placeholderCosts).toBe(false);
    expect(text(mine, "score")).not.toContain(PLACEHOLDER_COST_NOTE);
    expect(mine.costLines[2].detail).toContain("at $40.00/h");
  });
});

describe("explainRecommendation: what stopped a larger crate", () => {
  it("constraint-limited: PART-001 upright stops at 34, the base rating fails 35", () => {
    const { e } = find("PART-001", true);
    expect(e.quantity).toBe(34);
    expect(e.limit).toEqual({ kind: "constraint", quantity: 35, binding: "base-rating" });
    expect(text(e, "limit")).toMatch(/^The next size up, 35 per crate, fails a hard check: the base rating\. Base rated [\d,]+ kg/);
  });

  it("cost-limited: PART-001 lying down, a larger crate passes but costs more per part", () => {
    const { e, sweep } = find("PART-001", false);
    expect(sweep.recommendation!.costLimited).toBe(true);
    expect(e.limit.kind).toBe("cost");
    const larger = sweep.curve.slice(e.quantity).filter((p) => p.ok);
    const best = larger.reduce((a, b) => (b.crate!.scoreUsdPerPart < a.crate!.scoreUsdPerPart ? b : a));
    expect(e.limit.quantity).toBe(best.quantity);
    expect(text(e, "limit")).toContain("cost more per part");
    expect(text(e, "limit")).toContain(`The first larger crate to fail a hard check is ${sweep.recommendation!.stoppedBy!.quantity} per crate`);
  });

  it("names the tie-break when it decided the pick (PART-003 lying down: 42 over 36)", () => {
    const { e } = find("PART-003", false);
    expect(e.tieBreak).toBe("fewer-crates");
    expect(text(e, "pick")).toContain("ties for the lowest cost per part");
    expect(text(e, "pick")).toContain("the tie went to fewer crates");
    expect(text(find("PART-001", true).e, "pick")).toContain("none was needed here");
  });

  it("nothing stops it when every quantity up to the maximum passes", () => {
    const s = settings({ restingFaces: AS_MODELLED_FACES });
    const sweep = sweepQuantities(getPart("PART-001"), s, undefined, { maxQuantity: 10 });
    const e = explainRecommendation(sweep, undefined, s)!;
    expect(sweep.recommendation!.stoppedBy).toBeNull();
    expect(e.limit.kind).not.toBe("constraint");
    expect(text(e, "limit")).toMatch(/up to 10 per crate/);
  });
});

describe("explainRecommendation: considerations", () => {
  it("lists the hard checks with the limits used, the scope and the packing rules", () => {
    const t = text(find("PART-001", true).e, "considerations");
    for (const s of [
      "2,489 mm × 2,743 mm door",
      "16,000 mm floor",
      "1.5× the crate's short side",
      "19 mm beside each part",
      "1.5× load factor",
      "1,000 kg gross per crate",
      "no limit on parts per crate",
      "One part number per crate",
      "Wood and basic fasteners only",
      "Domestic truck freight",
      "parts kept upright",
      "until its model's outline is measured",
    ]) {
      expect(t).toContain(s);
    }
  });

  it("follows the resting faces rule, a part limit and a measured outline", () => {
    const s = settings({ restingFaces: ANY_FACES });
    const standards = custom({ limits: { perCrate: { maxParts: 12 } } });
    const sweep = sweepQuantities(getPart("PART-002"), s, standards);
    const t = text(explainRecommendation(sweep, standards, s, { measured: true })!, "considerations");
    expect(t).toContain("parts may rest on any face");
    expect(t).toContain("at most 12 parts per crate");
    expect(t).toContain("measured outline");
  });
});

describe("explainRecommendation: the chart's curve", () => {
  it.each(cases)("$id upright $keepUpright, rates $rates: from 1 to a little past the last passing quantity", ({ e, sweep }) => {
    expect(e.curve[0].quantity).toBe(1);
    const lastOk = sweep.curve.filter((p) => p.ok).at(-1)!.quantity;
    expect(e.curve.length).toBeGreaterThan(lastOk);
    expect(e.curve.some((p) => !p.ok)).toBe(true);
    for (const p of e.curve) expect(p.ok).toBe(p.scoreUsdPerPart !== null);
  });

  it("is null with no recommendation", () => {
    const none: QuantitySweep = { ...cases[0].sweep, recommendation: null };
    expect(explainRecommendation(none, undefined, cases[0].s)).toBeNull();
  });
});

describe("quantityRuns", () => {
  it("joins consecutive quantities", () => {
    expect(quantityRuns([1, 2, 3, 5, 7, 8])).toBe("1–3, 5 and 7–8");
    expect(quantityRuns([4])).toBe("4");
    expect(quantityRuns([])).toBe("none");
  });
});
