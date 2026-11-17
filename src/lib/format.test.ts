import { describe, expect, it } from "vitest";
import type { BomLine } from "@/domain/crate";
import {
  boardTooltipDetail,
  cautionNote,
  cautionVerdict,
  densityDelta,
  densityText,
  groupThousands,
  documentDate,
  elapsedText,
  hoursText,
  modelNote,
  savedDateText,
  usd,
  usdDelta,
} from "./format";

describe("cautionVerdict", () => {
  it("is empty without cautions", () => {
    expect(cautionVerdict([])).toBe("");
  });

  it("names one caution by its title", () => {
    expect(cautionVerdict(["Parts are not restrained"])).toBe("1 caution: parts are not restrained");
  });

  it("names two, and summarises more", () => {
    expect(cautionVerdict(["Parts are not restrained", "Part mass is a stand-in"])).toBe("2 cautions: parts are not restrained and part mass is a stand-in");
    expect(cautionVerdict(["Parts are not restrained", "Part mass is a stand-in", "3D model does not match"])).toBe(
      "3 cautions: parts are not restrained and 2 more",
    );
  });

  it("keeps the case of an acronym or a number", () => {
    expect(cautionVerdict(["3D model does not match the catalog"])).toBe("1 caution: 3D model does not match the catalog");
    expect(cautionVerdict(["LTL surcharge applies"])).toBe("1 caution: LTL surcharge applies");
  });
});

describe("scorecard formatting (#17)", () => {
  it("dollars", () => {
    expect(usd(186.14)).toBe("$186");
    expect(usd(1234.5)).toBe("$1,235");
    expect(usdDelta(12.4)).toBe("+$12");
    expect(usdDelta(-5.6)).toBe("−$6");
    expect(usdDelta(0.4)).toBe("same cost");
  });

  it("build time and time to design", () => {
    expect(hoursText(2.709)).toBe("2 h 43 m");
    expect(hoursText(0.75)).toBe("45 m");
    expect(elapsedText(45_200)).toBe("45 s");
    expect(elapsedText(72_000)).toBe("1 m 12 s");
    expect(elapsedText(3_780_000)).toBe("1 h 3 m");
    expect(elapsedText(-5)).toBe("0 s");
  });

  it("density in either unit", () => {
    expect(densityText(26.72, "imperial")).toBe("26.7 lb/ft³");
    expect(densityText(26.72, "metric")).toBe("428 kg/m³");
    expect(densityDelta(-2.14, "imperial")).toBe("−2.1 lb/ft³");
    expect(densityDelta(0.6, "metric")).toBe("+10 kg/m³");
    expect(densityDelta(0.01, "imperial")).toBe("");
  });
});

describe("documentDate", () => {
  // 23:16 on the 16th in Los Angeles is already the 17th in UTC: the case that printed the wrong day.
  const iso = "2026-11-17T07:16:00.000Z";

  it("reads the date in the given zone, not in UTC", () => {
    expect(documentDate(iso, "America/Los_Angeles")).toBe("2026-11-16");
    expect(documentDate(iso, "UTC")).toBe("2026-11-17");
    expect(documentDate(iso, "Pacific/Auckland")).toBe("2026-11-17");
  });

  it("uses this device's own zone when none is given", () => {
    const local = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(documentDate(iso)).toBe(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`);
  });

  it("falls back to the text's own date for a timestamp it cannot read", () => {
    expect(documentDate("2026-11-16 garbage")).toBe("2026-11-16");
  });
});

describe("savedDateText", () => {
  it("shows a saved-on date for people, and anything unreadable as it came", () => {
    expect(savedDateText("2026-11-16T12:00:00.000Z")).toMatch(/2026/);
    expect(savedDateText("last Tuesday")).toBe("last Tuesday");
  });
});

describe("modelNote", () => {
  it("says what the measurement was compared with", () => {
    expect(modelNote(true, false)).toBe("model matches catalog");
    expect(modelNote(false, true)).toBe("model does not match catalog");
    expect(modelNote(null, true)).toBe("units guessed from the size");
    expect(modelNote(null, false)).toBe("size measured from the file");
    expect(modelNote(null, undefined)).toBe("size measured from the file");
  });
});

describe("cautionNote", () => {
  it("counts cautions and points at Checks", () => {
    expect(cautionNote(0)).toBe("");
    expect(cautionNote(1)).toBe("1 caution, see Checks");
    expect(cautionNote(3)).toBe("3 cautions, see Checks");
  });
});

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

describe("groupThousands", () => {
  it("groups the whole numbers of a sentence", () => {
    expect(groupThousands("10000 parts ship as 333 crates (10 × 31 + 323 × 30)")).toBe("10,000 parts ship as 333 crates (10 × 31 + 323 × 30)");
    expect(groupThousands("Shipment · 12345 parts")).toBe("Shipment · 12,345 parts");
  });

  it("leaves small numbers, decimals and grouped numbers alone", () => {
    expect(groupThousands("999 parts at $22.91, 1.2345 m, 2,176 mm")).toBe("999 parts at $22.91, 1.2345 m, 2,176 mm");
  });

  it("groups dollars of a thousand or more", () => {
    expect(groupThousands("$1234.50 a part")).toBe("$1,234.50 a part");
  });
});
