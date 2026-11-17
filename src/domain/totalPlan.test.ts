import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { DEFAULT_SETTINGS } from "./design";
import { evenSplit, planTotal, sweepQuantities, type QuantitySweep } from "./sweep";
import { metricText } from "./testFixtures";
import { explainTotalPlan, planText, splitOutcome, splitText } from "./totalPlan";

const sweep = sweepQuantities(getPart("PART-001"), DEFAULT_SETTINGS);

/** A made-up curve: `cost(q)` per crate of q, failing quantities above `max`. */
function curve(maxQuantity: number, cost: (q: number) => number, max = maxQuantity): QuantitySweep {
  const crate = sweep.recommendation!.crate;
  return {
    basis: "crate-only",
    maxQuantity,
    candidates: null,
    curve: Array.from({ length: maxQuantity }, (_, i) => {
      const q = i + 1;
      return q <= max
        ? {
            quantity: q,
            ok: true,
            binding: null,
            reason: null,
            crate: { ...crate, crateCostUsd: cost(q), scoreUsdPerPart: cost(q) / q, freightUsd: null },
            layoutsDesigned: 1,
            layoutsPassed: 1,
          }
        : { quantity: q, ok: false, binding: "max-gross" as const, reason: [`Too heavy at ${q}.`], crate: null, layoutsDesigned: 0, layoutsPassed: 0 };
    }),
    shortlist: [],
    recommendation: null,
    problem: null,
  };
}

describe("splitText and planText", () => {
  it("name crates × parts each, fuller crates first", () => {
    expect(splitText(evenSplit(40, 2))).toBe("2 × 20");
    expect(splitText(evenSplit(40, 3))).toBe("1 × 14 + 2 × 13");
    expect(planText({ crates: 1, types: [{ count: 1, quantity: 40 }] })).toBe("1 crate of 40");
    expect(
      planText(
        planTotal(
          curve(30, () => 100),
          40,
        )!,
      ),
    ).toBe("2 crates × 20");
  });
});

describe("splitOutcome", () => {
  it("scores a split as planTotal does, and names the first failing size", () => {
    const s = curve(30, (q) => 100 + q, 25);
    const plan = planTotal(s, 40)!;
    const same = splitOutcome(s, 40, plan.crates);
    expect(same.ok && same.scoreUsdPerPart).toBeCloseTo(plan.scoreUsdPerPart, 9);
    expect(splitOutcome(s, 40, 1)).toMatchObject({ ok: false, overMax: true });
    expect(splitOutcome(s, 52, 2)).toMatchObject({ ok: false, overMax: false, reason: ["Too heavy at 26."] });
  });
});

describe("explainTotalPlan", () => {
  it("names the plan's cost, why one crate fewer fails and what one more costs", () => {
    // Crates cost $100 each up to 25 parts; 26 and up are too heavy.
    const s = curve(60, () => 100, 25);
    const plan = planTotal(s, 40)!;
    expect(plan).toMatchObject({ crates: 2, perCrate: 20 });
    expect(metricText(explainTotalPlan(s, 40))).toBe(
      "40 parts ship as 2 crates × 20 at $5.00 a part in crate cost. 1 crate of 40 would fail a hard check: Too heavy at 40. 3 crates (1 × 14 + 2 × 13) would cost $7.50 a part.",
    );
  });

  it("says a cheaper-looking fewer split costs more when it passes, and a tie on more crates", () => {
    // Bigger crates cost more per part above 20: 1 × 40 passes but costs more.
    const s = curve(60, (q) => (q <= 20 ? 100 : 100 + (q - 20) * 10));
    const text = metricText(explainTotalPlan(s, 40));
    expect(text).toMatch(/^40 parts ship as 2 crates × 20 at \$5\.00 a part/);
    expect(text).toContain("1 crate of 40 would cost $7.50 a part.");
    // A flat per-part curve: 3 crates cost the same per part.
    const flat = curve(60, (q) => q * 5);
    expect(metricText(explainTotalPlan(flat, 40))).toContain("2 crates × 20 would cost the same per part; fewer crates win a tie.");
  });

  it("says when fewer crates would need more than the sweep tries", () => {
    const s = curve(30, () => 100);
    expect(metricText(explainTotalPlan(s, 40))).toContain("1 crate of 40 would need more than the 30 parts a crate the sweep tries.");
  });

  it("explains a real part's plan from its sweep, with the check's own text", () => {
    const plan = planTotal(sweep, 40)!;
    const text = metricText(explainTotalPlan(sweep, 40));
    expect(text.startsWith(`40 parts ship as ${planText(plan)}`)).toBe(true);
    const fewer = splitOutcome(sweep, 40, plan.crates - 1);
    if (!fewer.ok && fewer.reason) expect(text).toContain(metricText(fewer.reason));
  });

  it("explains why there is no plan", () => {
    const none = curve(10, () => 100, 0);
    expect(metricText(explainTotalPlan(none, 5))).toBe("5 parts can't be planned: one part alone fails a hard check. Too heavy at 1.");
    expect(metricText(explainTotalPlan({ ...none, problem: { id: "x", title: "The part is too big.", detail: "" } as never }, 5))).toBe(
      "No crate can be designed for this part: The part is too big.",
    );
  });
});
