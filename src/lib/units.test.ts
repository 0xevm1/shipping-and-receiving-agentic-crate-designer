import { describe, expect, it } from "vitest";
import { cut, dims, dimsOther, fraction, length, partWeight, volume, weight } from "./units";

describe("units", () => {
  it("formats overall sizes", () => {
    expect(dims([932, 652, 497], "metric")).toBe("932 × 652 × 497");
    expect(dims([932, 652, 497], "imperial")).toBe("36.7 × 25.7 × 19.6");
    expect(dimsOther([932, 652, 497], "metric")).toBe("36.7 × 25.7 × 19.6 in");
    expect(length(25.4, "imperial")).toBe("1.0");
  });

  it("rounds cuts to the nearest sixteenth and reduces the fraction", () => {
    expect(fraction(25.4)).toBe("1″");
    expect(fraction(19)).toBe("3/4″");
    expect(fraction(89)).toBe("3 1/2″");
    expect(fraction(900)).toBe("35 7/16″");
    expect(cut(900, "metric")).toBe("900");
  });

  it("handles 1/16″ edge cases and whole inches", () => {
    expect(fraction(0)).toBe("0″");
    expect(fraction(0.4)).toBe("0″"); // under 1/32″ rounds down
    expect(fraction(25.4 / 32)).toBe("1/16″"); // exactly 1/32″ rounds up
    expect(fraction(25.4 / 16)).toBe("1/16″");
    expect(fraction(25.4 * (15 / 16))).toBe("15/16″");
    expect(fraction(25.3)).toBe("1″"); // just under an inch rounds to the whole inch
    expect(fraction(25.4 * 12)).toBe("12″");
    expect(fraction(25.4 * (12 + 31 / 32))).toBe("13″"); // carries into the next inch
    expect(fraction(25.4 * 2.5)).toBe("2 1/2″");
    expect(fraction(25.4 * 2.25)).toBe("2 1/4″");
    expect(fraction(25.4 * (2 + 3 / 8))).toBe("2 3/8″");
  });

  it("uses another inch mark when asked", () => {
    expect(fraction(900, " in")).toBe("35 7/16 in");
    expect(fraction(25.4, " in")).toBe("1 in");
    expect(fraction(19, "")).toBe("3/4");
  });

  it("converts weight and volume", () => {
    expect(weight(100, "metric")).toBe("100 kg");
    expect(weight(100, "imperial")).toBe("220 lb");
    expect(volume(1, "imperial")).toBe("35.3 ft³");
  });

  it("shows every mass by one rule: one decimal under 100, whole from 100 (#62)", () => {
    expect(weight(21.5, "metric")).toBe("21.5 kg");
    expect(weight(21.5, "imperial")).toBe("47.4 lb");
    expect(partWeight(21.5, "imperial")).toBe("47.4 lb");
    expect(weight(20, "metric")).toBe("20 kg"); // no trailing .0
    expect(weight(99.94, "metric")).toBe("99.9 kg");
    expect(weight(99.96, "metric")).toBe("100 kg"); // rounds up across the boundary: whole
    expect(weight(45.36, "imperial")).toBe("100 lb");
    expect(weight(135.2, "metric")).toBe("135 kg");
    expect(weight(1240.4, "metric")).toBe("1240 kg");
    expect(weight(1240.4, "metric", true)).toBe("1,240 kg");
  });
});
