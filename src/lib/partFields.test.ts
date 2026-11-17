import { describe, expect, it } from "vitest";
import type { DesignChange } from "@/domain/diff";
import { changeNote, NO_CHANGE, visibleChanges } from "./changes";
import { fieldWidthCh, formatMass, massUnit, parseMass, stepMass } from "./partFields";

describe("mass field (kg)", () => {
  it("shows the stored kg as entered, without float noise", () => {
    expect(formatMass(14.71, "metric")).toBe("14.71");
    expect(formatMass(10, "metric")).toBe("10");
    expect(formatMass(0.1 + 0.2, "metric")).toBe("0.3");
    expect(massUnit("metric")).toBe("kg");
  });

  it("parses a positive decimal, with an optional unit and a comma decimal mark", () => {
    expect(parseMass("12.5", "metric")).toEqual({ ok: true, kg: 12.5 });
    expect(parseMass(" 12.5 kg ", "metric")).toEqual({ ok: true, kg: 12.5 });
    expect(parseMass("12,5", "metric")).toEqual({ ok: true, kg: 12.5 });
    expect(parseMass(".5", "metric")).toEqual({ ok: true, kg: 0.5 });
  });

  it("rejects blank, non-numeric, zero and negative text with a one-line reason", () => {
    expect(parseMass("", "metric")).toEqual({ ok: false, error: "Enter the mass of one part in kg." });
    expect(parseMass("abc", "metric")).toEqual({ ok: false, error: "Enter a number of kg, like 12.5." });
    expect(parseMass("1e3", "metric").ok).toBe(false);
    expect(parseMass("-2", "metric").ok).toBe(false);
    expect(parseMass("0", "metric")).toEqual({ ok: false, error: "Mass must be more than 0 kg." });
  });

  it("steps by 0.1 kg, or 1 kg with Shift, and never below one step", () => {
    expect(stepMass(10, 1, false, "metric")).toBe(10.1);
    expect(stepMass(14.71, -1, false, "metric")).toBe(14.61);
    expect(stepMass(10, 1, true, "metric")).toBe(11);
    expect(stepMass(0.1, -1, false, "metric")).toBe(0.1);
    expect(stepMass(0.5, -1, true, "metric")).toBe(0.5);
  });
});

describe("mass field (lb ↔ kg)", () => {
  it("shows kg as lb to 2 decimals", () => {
    expect(formatMass(10, "imperial")).toBe("22.05");
    expect(formatMass(21.5, "imperial")).toBe("47.4");
    expect(massUnit("imperial")).toBe("lb");
  });

  it("converts typed lb to kg, and back to the same text", () => {
    const r = parseMass("30 lb", "imperial");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kg).toBeCloseTo(13.6078, 4);
    expect(formatMass(r.kg, "imperial")).toBe("30");
    expect(parseMass("0", "imperial")).toEqual({ ok: false, error: "Mass must be more than 0 lb." });
  });

  it("steps in the shown unit", () => {
    const kg = stepMass(10, 1, false, "imperial"); // 22.05 lb → 22.15 lb
    expect(formatMass(kg, "imperial")).toBe("22.15");
    expect(formatMass(stepMass(10, -1, true, "imperial"), "imperial")).toBe("21.05");
  });
});

describe("fieldWidthCh", () => {
  it("fits the text, or the placeholder when empty, within the bounds", () => {
    expect(fieldWidthCh("Gearbox cover", "name", 6, 40)).toBe(14);
    expect(fieldWidthCh("", "add material", 6, 30)).toBe(13);
    expect(fieldWidthCh("x", "", 4, 10)).toBe(4);
    expect(fieldWidthCh("x".repeat(80), "", 6, 40)).toBe(40);
  });
});

describe("change note", () => {
  const gross: DesignChange = { field: "gross", from: 15.57, to: 20.28 };
  const panel: DesignChange = { field: "panel", from: 12, to: 15 };
  const payload: DesignChange = { field: "payload", from: 10, to: 10.1 };

  it("says what moved, in the selected units", () => {
    expect(changeNote([gross], "metric")).toBe("Gross 16 → 20 kg");
    expect(changeNote([gross], "imperial")).toBe("Gross 34 → 45 lb");
    expect(changeNote([gross, panel], "metric")).toBe("Gross 16 → 20 kg, wall plywood 12 → 15 mm");
    expect(changeNote([panel], "imperial")).toBe("Wall plywood 1/2″ → 9/16″");
  });

  it("lists two changes, then a count", () => {
    const outside: DesignChange = { field: "outside", from: [240, 240, 317], to: [240, 240, 400] };
    expect(changeNote([gross, outside, panel], "metric")).toBe("Gross 16 → 20 kg, outside 240 × 240 × 317 → 240 × 240 × 400 mm, +1 more");
  });

  it("drops changes that look the same in these units", () => {
    expect(visibleChanges([payload], "metric")).toEqual([]);
    expect(changeNote([payload], "metric")).toBe(NO_CHANGE);
    expect(changeNote([], "metric")).toBe("No change to the crate");
  });
});
