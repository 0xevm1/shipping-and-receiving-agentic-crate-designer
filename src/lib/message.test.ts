import { describe, expect, it } from "vitest";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { getPart } from "@/domain/catalog";
import { dimsMessage, kg, longMm, mm, msg, parts, shopMm } from "@/domain/message";
import { renderMessage } from "./message";

describe("renderMessage (#62)", () => {
  const m = msg`A ${mm(2489)} × ${mm(2743)} door, a ${shopMm(19)} floor, ${shopMm(89)} clear, ${kg(1240)} and ${kg(21.5)}.`;

  it("reads as the checks always did in metric", () => {
    expect(renderMessage(m, "metric")).toBe("A 2,489 mm × 2,743 mm door, a 19 mm floor, 89 mm clear, 1,240 kg and 21.5 kg.");
  });

  it("converts every length and mass in imperial", () => {
    expect(renderMessage(m, "imperial")).toBe("A 98.0 in × 108.0 in door, a 3/4″ floor, 3 1/2″ clear, 2,734 lb and 47.4 lb.");
  });

  it("says a long distance in metres or feet", () => {
    expect(renderMessage(msg`${longMm(30000)} and ${longMm(20000)}`, "metric")).toBe("30 m and 20 m");
    expect(renderMessage(msg`${longMm(30000)} and ${longMm(20000)}`, "imperial")).toBe("98.4 ft and 65.6 ft");
  });

  it("states the limit and the size in the selected units when a part is too large to crate", () => {
    const part = { ...getPart("PART-001")!, dimensions_mm: [30000, 100, 100] as [number, number, number] };
    const { problem } = computeDesign(part, DEFAULT_SETTINGS);
    expect(problem?.id).toBe("part-too-large");
    expect(renderMessage(problem!.detail, "metric")).toContain("longest side is 30 m and the limit is 20 m");
    expect(renderMessage(problem!.detail, "imperial")).toContain("longest side is 98.4 ft and the limit is 65.6 ft");
    expect(renderMessage(problem!.detail, "imperial")).not.toMatch(/\bmm\b/);
  });

  it("merges strings, flattens nested messages and joins dimensions", () => {
    expect(parts("a", 1, parts("b"), "c")).toEqual(["a1bc"]);
    expect(renderMessage(dimsMessage([25.4, 50.8]), "imperial")).toBe("1.0 in × 2.0 in");
    expect(renderMessage(msg`${dimsMessage([10, 20])} space`, "metric")).toBe("10 mm × 20 mm space");
  });

  it("leaves no metric unit in any imperial check message of real designs", () => {
    for (const id of ["PART-001", "PART-002", "PART-003"]) {
      const part = getPart(id);
      if (!part) continue;
      for (const quantity of [1, 8, 40]) {
        const r = computeDesign(part, { ...DEFAULT_SETTINGS, quantity });
        for (const c of r.design?.checks ?? []) {
          const text = renderMessage(c.detail, "imperial");
          expect(text, `${id} x${quantity} ${c.id}`).not.toMatch(/\bmm\b|\bkg\b/);
        }
      }
    }
  });
});
