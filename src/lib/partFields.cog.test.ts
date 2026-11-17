import { describe, expect, it } from "vitest";
import { cogSourceNote, cogUnit, formatCog, parseCog } from "./partFields";

/** The centre-of-gravity field in Part details (#110). */
const SIZE: [number, number, number] = [1000, 200, 100];

describe("centre of gravity field", () => {
  it("shows the offset in the selected length unit", () => {
    expect(formatCog([120, 0, -15.56], "metric")).toBe("120, 0, -15.6");
    expect(formatCog([25.4, -50.8, 0], "imperial")).toBe("1, -2, 0");
    expect(cogUnit("metric")).toBe("mm");
    expect(cogUnit("imperial")).toBe("in");
    expect(formatCog([-0.001, 0, 0], "metric")).toBe("0, 0, 0");
  });

  it("parses three numbers with commas, semicolons or spaces, and an optional unit", () => {
    expect(parseCog("120, 0, -15", "metric", SIZE)).toEqual({ ok: true, offsetMm: [120, 0, -15] });
    expect(parseCog("120 0 -15 mm", "metric", SIZE)).toEqual({ ok: true, offsetMm: [120, 0, -15] });
    expect(parseCog("12,5; 0; 1,5", "metric", SIZE)).toEqual({ ok: true, offsetMm: [12.5, 0, 1.5] });
  });

  it("converts inches to mm", () => {
    expect(parseCog("2, 0, -1 in", "imperial", SIZE)).toEqual({ ok: true, offsetMm: [50.8, 0, -25.4] });
  });

  it("clears on blank", () => {
    expect(parseCog("  ", "metric", SIZE)).toEqual({ ok: true, offsetMm: null });
  });

  it("rejects the wrong count, non-numbers and exponents with one line", () => {
    for (const bad of ["1, 2", "1, 2, 3, 4", "a, b, c", "1e2, 0, 0", "1 - 2 3"]) {
      const r = parseCog(bad, "metric", SIZE);
      expect(r).toEqual({ ok: false, error: "Enter three distances from the middle of the part in mm, like 120, 0, -15 (blank to clear)." });
    }
  });

  it("rejects a centre outside the part's box, naming the axis and the limit in the shown unit", () => {
    expect(parseCog("0, 150, 0", "metric", SIZE)).toEqual({
      ok: false,
      error: "The Y distance must be within ±100 mm: the centre has to be inside the part's box.",
    });
    expect(parseCog("0, 0, 3", "imperial", SIZE)).toEqual({
      ok: false,
      error: "The Z distance must be within ±1.969 in: the centre has to be inside the part's box.",
    });
    expect(parseCog("500, 100, 50", "metric", SIZE).ok).toBe(true); // on the faces
  });

  it("says where the centre came from", () => {
    expect(cogSourceNote("supplied")).toBe("supplied");
    expect(cogSourceNote("estimated")).toBe("estimated from the mesh");
    expect(cogSourceNote(undefined)).toBe("assumed at the middle of the box");
    expect(cogSourceNote(undefined, "open")).toBe("assumed at the middle of the box (the mesh isn't closed)");
    expect(cogSourceNote(undefined, "unreliable")).toBe("assumed at the middle of the box (the mesh gave no reliable centre)");
  });
});
