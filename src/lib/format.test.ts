import { describe, expect, it } from "vitest";
import { cautionNote, densityDelta, densityText, documentDate, elapsedText, hoursText, modelNote, usd, usdDelta } from "./format";

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

describe("modelNote", () => {
  it("says what the measurement was compared with", () => {
    expect(modelNote(true, false)).toBe("model matches catalog");
    expect(modelNote(false, true)).toBe("model does not match catalog");
    expect(modelNote(null, true)).toBe("file read as millimetres");
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
