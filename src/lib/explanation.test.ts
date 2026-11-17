import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { explainRecommendation } from "@/domain/explainRecommendation";
import { planShipment } from "@/domain/shipment";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { sweepQuantities } from "@/domain/sweep";
import { explanationText, perPartDelta } from "./explanation";
import { buildPrintable } from "./printable";

const part = getPart("PART-001");
const sweep = sweepQuantities(part, DEFAULT_SETTINGS);
const explanation = explainRecommendation(sweep, DEFAULT_STANDARDS, DEFAULT_SETTINGS)!;

describe("explanationText", () => {
  it("follows the units toggle in its sentences, never in its dollars", () => {
    const [imperial, metric] = [explanationText(explanation, "imperial"), explanationText(explanation, "metric")];
    const considered = (x: typeof imperial) => x.sections.find((s) => s.id === "considerations")!.lines.join(" ");
    expect(considered(metric)).toContain("1,000 kg gross per crate");
    expect(considered(imperial)).toContain("2,205 lb gross per crate");
    expect(considered(imperial)).not.toMatch(/\bmm\b|\bkg\b/);
    expect(imperial.costLines).toEqual(metric.costLines);
  });

  it("says freight is not priced without rates, and compares the shortlist with the pick", () => {
    const x = explanationText(explanation, "imperial");
    expect(x.costLines.find((l) => l.label === "Freight")!.value).toBe("Not priced");
    expect(x.ranking[0]).toMatchObject({ quantity: x.quantity, vsPick: "pick", picked: true });
    for (const r of x.ranking.slice(1)) expect(r.vsPick).toMatch(/^(\+\$\d+\.\d\d|same)$/);
  });

  it("signs a difference per part to the cent", () => {
    expect(perPartDelta(0.174)).toBe("+$0.17");
    expect(perPartDelta(-0.02)).toBe("−$0.02");
    expect(perPartDelta(0.004)).toBe("same");
  });
});

describe("the crate spec's quantity section carries the same explanation", () => {
  const rec = sweep.recommendation!;
  const settings = { ...DEFAULT_SETTINGS, quantity: rec.quantity };
  const plan = planShipment(part, settings, rec.crate.layoutKey);
  const input = {
    part,
    plan,
    standards: DEFAULT_STANDARDS,
    units: "imperial" as const,
    ranking: "volume" as const,
    generatedAt: "2026-11-17T12:00:00Z",
    sweep,
  };

  it("with the rules it was swept under", () => {
    const doc = buildPrintable({ ...input, settings });
    expect(doc.quantity!.why).toEqual(explanationText(explanation, "imperial"));
  });

  it("and none without them (it would not know which rules)", () => {
    expect(buildPrintable(input).quantity!.why).toBeNull();
  });
});
