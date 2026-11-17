import { describe, expect, it } from "vitest";
import { densityDelta, densityText, elapsedText, hoursText, usd, usdDelta } from "./format";

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
