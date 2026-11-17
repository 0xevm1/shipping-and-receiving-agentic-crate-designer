import { describe, expect, it } from "vitest";
import { editUnit, cut, dims, dimsOther, fraction, groupDigits, length, partWeight, volume, weight, weightFromLb, weightWhole } from "./units";

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

  it("groups thousands for a quantity beside its unit, and for whole-unit masses", () => {
    expect(groupDigits(30000)).toBe("30,000");
    expect(groupDigits(950)).toBe("950");
    expect(weightWhole(6131.6, "imperial")).toBe("13,518 lb");
    expect(weightWhole(16.4, "metric")).toBe("16 kg");
  });

  it("shows every mass by one rule: one decimal under 100, whole from 100 ", () => {
    expect(weight(21.5, "metric")).toBe("21.5 kg");
    expect(weight(21.5, "imperial")).toBe("47.4 lb");
    expect(partWeight(21.5, "imperial")).toBe("47.4 lb");
    expect(weight(20, "metric")).toBe("20 kg"); // no trailing .0
    expect(weight(99.94, "metric")).toBe("99.9 kg");
    expect(weight(99.96, "metric")).toBe("100 kg"); // rounds up across the boundary: whole
    expect(weight(45.36, "imperial")).toBe("100 lb");
    expect(weight(135.2, "metric")).toBe("135 kg");
    expect(weight(1240.4, "metric")).toBe("1,240 kg"); // grouped by default
    expect(weight(1240.4, "metric", false)).toBe("1240 kg");
    expect(weight(6131.6, "imperial")).toBe("13,518 lb");
    expect(weightFromLb(13518, "imperial")).toBe("13,518 lb");
    expect(weightFromLb(100, "metric")).toBe("45.4 kg");
  });

  describe("editing standards in the selected units", () => {
    it("shows stock by its nominal inches and stores the metric size it is", () => {
      const lumber = editUnit("lumber", "imperial");
      expect([19, 38, 89, 140].map(lumber.show)).toEqual([0.75, 1.5, 3.5, 5.5]);
      expect([0.75, 1.5, 3.5, 5.5].map(lumber.store)).toEqual([19, 38, 89, 140]);
      const ply = editUnit("plywood", "imperial");
      expect([12, 15, 19, 18, 16].map(ply.show)).toEqual([0.5, 0.625, 0.75, 0.75, 0.625]);
      expect([0.5, 0.625, 0.75].map(ply.store)).toEqual([12, 15, 19]);
    });

    it("leaves metric and dimensionless fields exactly as stored", () => {
      for (const dim of ["length", "lumber", "plywood", "mass", "density", "cost"] as const) {
        const m = editUnit(dim, "metric");
        expect([m.unit, m.show(123.456), m.store(123.456)]).toEqual([null, 123.456, 123.456]);
      }
      expect(editUnit(undefined, "imperial").unit).toBeNull();
    });

    it.each([
      ["length", [0.25, 1.97, 31.5, 100.98, 630, 0.01]],
      ["lumber", [0.75, 3.5, 3.504, 3.938, 5.25]],
      ["plywood", [0.5, 0.625, 0.75, 0.8, 1.25]],
      ["mass", [0.1, 33.07, 330.69, 1102.31, 2204.62, 55.55]],
      ["density", [37.46, 30, 41.25]],
      ["cost", [18.4, 31.15, 25]],
    ] as const)("a %s typed in imperial reads back the same after saving", (dim, typed) => {
      const u = editUnit(dim, "imperial");
      for (const v of typed) {
        const stored = u.store(v);
        // Through JSON, as the standards file and local storage keep it.
        const reloaded = JSON.parse(JSON.stringify(stored)) as number;
        expect(u.show(reloaded), `${v}`).toBe(v);
        // Showing and storing again is stable: the second save doesn't move the metric value.
        expect(u.store(u.show(reloaded))).toBe(reloaded);
      }
    });
  });
});
