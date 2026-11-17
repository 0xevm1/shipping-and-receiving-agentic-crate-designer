import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { custom, designOf } from "@/domain/testFixtures";
import { bomToCsv } from "./csv";
import { renderMessage } from "./message";
import { catalogPart } from "./part";
import { sheetRows, sheetSizeText, sheetsHint, sheetsTotal } from "./sheets";

const part = getPart("PART-002");
const spliced = designOf(part, { quantity: 42 });
const check = spliced.checks.find((c) => c.id === "spliced")!;

describe("sheet text", () => {
  it("names the shipped sheet by feet in imperial and by mm in metric", () => {
    expect(sheetSizeText({ width: 1220, length: 2440 }, "imperial")).toBe("4 × 8 ft");
    expect(sheetSizeText({ width: 1220, length: 2440 }, "metric")).toBe("1220 × 2440 mm");
    expect(sheetSizeText({ width: 1000, length: 2000 }, "imperial")).toBe("39.4 × 78.7 in");
  });
  it("states the count and how it was made", () => {
    expect(sheetsTotal(spliced.sheets)).toBe(`~${spliced.sheets.total}`);
    expect(sheetsHint(spliced.sheets, "imperial")).toMatch(/of 4 × 8 ft sheets \(piece area \+ 15% waste, no nesting\)/);
    expect(sheetsHint(spliced.sheets, "metric")).toMatch(/\d+ mm: \d+/);
  });
  it("writes one CSV row per plywood thickness", () => {
    const rows = sheetRows(spliced.sheets, "metric");
    expect(rows).toHaveLength(spliced.sheets.lines.length);
    expect(rows[0]).toMatch(/^Plywood sheets \(approx\),plywood,\d+ mm,1220 x 2440,\d+$/);
    expect(sheetRows(spliced.sheets, "imperial")[0]).toMatch(/^Plywood sheets \(approx\),plywood,.+ in,.+ in x .+ in,\d+$/);
    expect(bomToCsv(catalogPart(part), spliced, "metric")).toContain(rows[0]);
  });
});

describe("the splice check in each unit system", () => {
  it("says the sheet and the panel sizes in mm or inches", () => {
    expect(renderMessage(check.detail, "metric")).toMatch(/1,220 mm × 2,440 mm sheet/);
    expect(renderMessage(check.detail, "imperial")).toMatch(/48\.0 in × 96\.1 in sheet/);
  });
  it("says the longest lumber in each system", () => {
    const d = designOf(part, { quantity: 42 }, custom({ stock: { maxLumberLengthMm: 4000 } }));
    const c = d.checks.find((x) => x.id === "lumber-length")!;
    expect(renderMessage(c.detail, "metric")).toContain("4,000 mm");
    expect(renderMessage(c.detail, "imperial")).toMatch(/157\.\d in/);
  });
});
