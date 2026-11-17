import { describe, expect, it } from "vitest";
import { cut, dims, dimsOther, fraction, length, volume, weight } from "./units";

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

  it("converts weight and volume", () => {
    expect(weight(100, "metric")).toBe("100 kg");
    expect(weight(100, "imperial")).toBe("220 lb");
    expect(volume(1, "imperial")).toBe("35.3 ft³");
  });
});
