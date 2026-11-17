import { describe, expect, it } from "vitest";
import { getPart, parts } from "./catalog";
import { explainRecommendation, noRecommendationMessage } from "./explainRecommendation";
import {
  candidateQuantities,
  compareSweepPoints,
  DEFAULT_SUGGESTED_QUANTITIES,
  normalizeCandidates,
  planTotal,
  sweepQuantities,
  SWEEP_MAX_QUANTITY,
} from "./sweep";
import type { DesignPart } from "./schema";
import { metricText, settings } from "./testFixtures";

/** The recommendation among the part's suggested quantities (#133). */

const rec = (part: DesignPart, candidates?: readonly number[]) => sweepQuantities(part, settings(), undefined, { candidates });

describe("candidates: the quantities a part is suggested in", () => {
  it("normalise to whole numbers 1..200, once each, ascending", () => {
    expect(normalizeCandidates([8, 2, 8, 0, 3.5, 250, -1, 200, 6])).toEqual([2, 6, 8, 200]);
    expect(normalizeCandidates([])).toEqual([]);
  });

  it("default to 1, 4 and 8 when a part has none (or none a crate can be set to)", () => {
    expect(DEFAULT_SUGGESTED_QUANTITIES).toEqual([1, 4, 8]);
    expect(candidateQuantities(undefined)).toEqual([1, 4, 8]);
    expect(candidateQuantities([])).toEqual([1, 4, 8]);
    expect(candidateQuantities([250])).toEqual([1, 4, 8]);
    expect(candidateQuantities([6, 2])).toEqual([2, 6]);
  });
});

describe("sweepQuantities with candidates", () => {
  it.each(parts)("$id recommends among its suggested quantities, the cheapest per part of those that pass", (p) => {
    const sweep = rec(p, p.suggested_quantities);
    expect(sweep.candidates).toEqual([...p.suggested_quantities].sort((a, b) => a - b));
    const passing = sweep.candidates!.map((q) => sweep.curve[q - 1]).filter((x) => x.ok);
    const best = [...passing].sort(compareSweepPoints)[0];
    expect(sweep.recommendation!.quantity).toBe(best.quantity);
    expect(p.suggested_quantities).toContain(sweep.recommendation!.quantity);
    expect(sweep.shortlist.map((x) => x.quantity).sort((a, b) => a - b)).toEqual(passing.map((x) => x.quantity));
    // The recommended crate is the one the full sweep designed for that quantity.
    expect(sweep.recommendation!.crate).toEqual(sweep.curve[best.quantity - 1].crate);
  });

  it("opens the sample parts at 8, 4 and 8 per crate (not 34, 16 and 38)", () => {
    const open = Object.fromEntries(parts.map((p) => [p.id, rec(p, p.suggested_quantities).recommendation!.quantity]));
    expect(open).toEqual({ "PART-001": 8, "PART-002": 4, "PART-003": 8 });
  });

  it("a part with no entry (a loaded GLB) is recommended among 1, 4 and 8", () => {
    const glb: DesignPart = { id: "glb", name: "Loaded", mass_kg: 12, dimensions_mm: [300, 200, 150] };
    const sweep = rec(glb, candidateQuantities(undefined));
    expect(sweep.candidates).toEqual([1, 4, 8]);
    expect([1, 4, 8]).toContain(sweep.recommendation!.quantity);
    expect(sweep.shortlist.every((x) => [1, 4, 8].includes(x.quantity))).toBe(true);
  });

  it("suggested quantities of [2, 6] recommend among 2 and 6", () => {
    const sweep = rec(getPart("PART-001"), candidateQuantities([2, 6]));
    expect(sweep.candidates).toEqual([2, 6]);
    expect(sweep.shortlist.map((x) => x.quantity).sort()).toEqual([2, 6]);
    expect([2, 6]).toContain(sweep.recommendation!.quantity);
    // 6 is cheaper per part than 2, and both pass: the larger one wins.
    expect(sweep.recommendation!.quantity).toBe(6);
  });

  it("keeps the full curve and leaves it unchanged", () => {
    const p = getPart("PART-001");
    const all = rec(p);
    const some = rec(p, [1, 4, 8]);
    expect(some.curve).toEqual(all.curve);
    expect(some.curve).toHaveLength(SWEEP_MAX_QUANTITY);
  });

  it("without candidates behaves as before: among every quantity, candidates null", () => {
    const sweep = rec(getPart("PART-001"));
    expect(sweep.candidates).toBeNull();
    expect(sweep.recommendation!.quantity).toBe(34);
    expect(sweep.shortlist).toHaveLength(5);
    expect(metricText(sweep.recommendation!.rationale)).toMatch(/^34 per crate costs \$/);
    expect(sweepQuantities(getPart("PART-001"), settings(), undefined, { candidates: [] }).candidates).toBeNull();
  });

  it("decides what stopped a larger crate among the candidates only", () => {
    // PART-001 fails above 34, but 40 is a candidate that fails: it is what stopped the larger ones.
    const sweep = rec(getPart("PART-001"), [4, 8, 40]);
    const r = sweep.recommendation!;
    expect(r.quantity).toBe(8);
    expect(r.stoppedBy).toMatchObject({ quantity: 40 });
    expect(r.stoppedBy!.binding).toBe(sweep.curve[39].binding);
    expect(metricText(r.rationale)).toContain("Of 4, 8 and 40 per crate, 8 costs least per part");
    // The pick is the largest candidate that passes and nothing above it fails: no stop.
    const none = rec(getPart("PART-001"), [1, 4, 8]).recommendation!;
    expect(none.stoppedBy).toBeNull();
    expect(none.costLimited).toBe(false);
  });

  it("curve points past the sweep's maximum are tried when they are candidates", () => {
    const sweep = sweepQuantities(getPart("PART-001"), settings(), undefined, { maxQuantity: 5, candidates: [4, 8] });
    expect(sweep.maxQuantity).toBe(8);
    expect(sweep.curve).toHaveLength(8);
  });

  it("says the comparison is among the suggested quantities", () => {
    const sweep = rec(getPart("PART-001"), [1, 4, 8]);
    expect(metricText(sweep.recommendation!.rationale)).toMatch(/^Of 1, 4 and 8 per crate, 8 costs least per part: \$\d+\.\d\d in crate cost/);
    const e = explainRecommendation(sweep, undefined, settings())!;
    expect(metricText(e.headline)).toContain("of the part's suggested quantities (1, 4 and 8) that pass every hard check");
    const section = (id: string) =>
      e.sections
        .find((s) => s.id === id)!
        .lines.map(metricText)
        .join("\n");
    expect(section("compared")).toContain("The part's suggested quantities: 1, 4 and 8 per crate");
    expect(section("compared")).toContain("3 suggested quantities passed (1, 4 and 8)");
    expect(section("pick")).toContain("lowest cost per part of every passing suggested quantity");
    expect(section("limit")).toContain("8 per crate is the largest of the suggested quantities (1, 4 and 8)");
    // The shortlist is the candidates; the chart keeps the whole curve and marks them.
    expect(e.ranking.map((r) => r.quantity).sort((a, b) => a - b)).toEqual([1, 4, 8]);
    expect(e.curve.filter((c) => c.candidate).map((c) => c.quantity)).toEqual([1, 4, 8]);
    expect(e.curve.length).toBeGreaterThan(30);
  });

  it("names the failing candidate and its rule in the limit text", () => {
    const e = explainRecommendation(rec(getPart("PART-001"), [4, 8, 40]), undefined, settings())!;
    const limit = e.sections
      .find((s) => s.id === "limit")!
      .lines.map(metricText)
      .join("\n");
    expect(limit).toMatch(/The next suggested quantity up, 40 per crate, fails a hard check/);
    expect(e.limit).toMatchObject({ kind: "constraint", quantity: 40 });
  });
});

describe("when no candidate passes", () => {
  // A heavy part: 4 or 8 of them are over the 1,000 kg per-crate gross limit before the crate.
  const heavy: DesignPart = { id: "heavy", name: "Heavy", mass_kg: 400, dimensions_mm: [300, 300, 300] };
  const sweep = rec(heavy, [4, 8]);

  it("recommends nothing and shortlists nothing", () => {
    expect(sweep.recommendation).toBeNull();
    expect(sweep.shortlist).toEqual([]);
    expect(sweep.candidates).toEqual([4, 8]);
    // The curve is still there: 1 and 2 pass, they just are not suggested.
    expect(sweep.curve[0].ok).toBe(true);
    expect(explainRecommendation(sweep, undefined, settings())).toBeNull();
  });

  it("says plainly which rule each candidate failed", () => {
    const text = metricText(noRecommendationMessage(sweep)!);
    expect(text).toContain("None of the part's suggested quantities (4 and 8 per crate) passes every hard check");
    expect(text).toContain("4 per crate fails the per-crate gross limit");
    expect(text).toContain("8 per crate fails the per-crate gross limit");
  });

  it("says the old thing when the sweep had no candidates, and nothing when there is a pick", () => {
    expect(noRecommendationMessage(rec(getPart("PART-001"), [1, 4, 8]))).toBeNull();
    const all = sweepQuantities({ ...heavy, mass_kg: 5000 }, settings());
    expect(all.recommendation).toBeNull();
    expect(metricText(noRecommendationMessage(all)!)).toBe("No quantity per crate passes every hard check with these rules.");
  });
});

describe("total-quantity mode keeps the full curve", () => {
  it("plans a total the same with or without candidates", () => {
    const p = getPart("PART-001");
    const plain = planTotal(rec(p), 40);
    const among = planTotal(rec(p, [1, 4, 8]), 40);
    expect(among).toEqual(plain);
    // 40 parts ship as 2 crates of 20, a quantity that is not suggested.
    expect(among).toMatchObject({ crates: 2, perCrate: 20 });
  });
});
