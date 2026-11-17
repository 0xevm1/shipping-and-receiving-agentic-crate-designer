import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { planShipment, sizeLimitText } from "@/domain/shipment";
import { custom, settings } from "@/domain/testFixtures";
import { renderMessage } from "./message";

/** The per-crate size limit's messages read in the selected units (#108). */
describe("size limit messages", () => {
  const limited = custom({ limits: { perCrate: { maxOutsideMm: { length: 1000, width: 700, height: 700 } } } });

  it("render in metric and imperial", () => {
    const plan = planShipment(getPart("PART-001"), settings({ quantity: 34 }), null, limited);
    const detail = plan.crates[0].result.design!.checks.find((c) => c.id === "crate-limit")!.detail;
    expect(renderMessage(detail, "metric")).toContain("1,000 mm × 700 mm × 700 mm outside");
    expect(renderMessage(detail, "imperial")).toContain("39.4 in × 27.6 in × 27.6 in outside");
  });

  it("render a one-part-over message and a partial limit in both units", () => {
    const tiny = custom({ limits: { perCrate: { maxOutsideMm: { length: 600, width: 400, height: 400 } } } });
    const plan = planShipment(getPart("PART-001"), settings({ quantity: 3 }), null, tiny);
    expect(renderMessage(plan.unmet!, "imperial")).toContain("23.6 in × 15.7 in × 15.7 in outside");
    const heightOnly = sizeLimitText(custom({ limits: { perCrate: { maxOutsideMm: { length: 0, width: 0, height: 1000 } } } }))!;
    expect(renderMessage(heightOnly, "imperial")).toBe("outside height 39.4 in at most");
    expect(renderMessage(heightOnly, "metric")).toBe("outside height 1,000 mm at most");
  });
});
