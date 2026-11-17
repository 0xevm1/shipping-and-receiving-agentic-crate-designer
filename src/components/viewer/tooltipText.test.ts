import { describe, expect, it } from "vitest";
import type { BomLine } from "@/domain/crate";
import { boardTooltipDetail } from "./tooltipText";

const plywood = { material: "plywood", kind: "floor", stockMm: [12], cutMm: [900, 600], qty: 2 } as unknown as BomLine;
const lumber = { material: "pine", kind: "cleat", stockMm: [19, 89], cutMm: [932], qty: 8 } as unknown as BomLine;

describe("boardTooltipDetail", () => {
  it("metric: bare numbers, the unit once after the cut", () => {
    expect(boardTooltipDetail(plywood, "metric")).toBe("12 mm plywood, cut 900 × 600 mm. 2 in this crate");
    expect(boardTooltipDetail(lumber, "metric")).toBe("19 × 89 lumber, cut 932 mm. 8 in this crate");
  });

  it("imperial: the cut carries its own inch mark, so no unit is added", () => {
    const text = boardTooltipDetail(plywood, "imperial");
    expect(text).toMatch(/^.+ plywood, cut .+″ × .+″\. 2 in this crate$/);
    expect(text).not.toContain(" in. ");
    expect(text).not.toMatch(/ mm/);
  });
});
