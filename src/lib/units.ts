/**
 * Display-only unit formatting. The domain stays in mm and kg (spec §4); these
 * helpers convert at the last moment for the metric / imperial toggle.
 */

import { LB_PER_KG, MM_PER_IN } from "@/domain/units";

export type Units = "metric" | "imperial";

const FT3_PER_M3 = 35.3147;
const FT2_PER_M2 = 10.7639;
const FT_PER_M = 3.28084;

export const lengthUnit = (u: Units) => (u === "imperial" ? "in" : "mm");

/** Overall sizes: whole mm, or inches to one decimal. */
export function length(mm: number, u: Units): string {
  return u === "imperial" ? (mm / MM_PER_IN).toFixed(1) : String(Math.round(mm));
}

export function dims(mm: readonly number[], u: Units): string {
  return mm.map((v) => length(v, u)).join(" × ");
}

/** The same size in the other unit system, with its unit. */
export function dimsOther(mm: readonly number[], u: Units): string {
  return u === "imperial" ? `${dims(mm, "metric")} mm` : `${dims(mm, "imperial")} in`;
}

/**
 * Shop measurements: inches to the nearest 1/16, e.g. 35 7/16″. `mark` is the inch sign; the
 * CSV passes " in" to stay plain ASCII.
 */
export function fraction(mm: number, mark = "″"): string {
  const sixteenths = Math.round((mm / MM_PER_IN) * 16);
  const whole = Math.floor(sixteenths / 16);
  let num = sixteenths % 16;
  let den = 16;
  while (num && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  if (!num) return `${whole}${mark}`;
  return whole ? `${whole} ${num}/${den}${mark}` : `${num}/${den}${mark}`;
}

/** A cut or stock size: whole mm, or fractional inches. */
export function cut(mm: number, u: Units): string {
  return u === "imperial" ? fraction(mm) : String(Math.round(mm));
}

/**
 * The one rule for a mass shown to people: in the displayed unit, one decimal under 100
 * ("47.4 lb"; a trailing .0 is dropped) and whole numbers from 100 up ("297 lb"), with thousands
 * separators ("13,518 lb"), as money and check messages have. Pass `group = false` for text that
 * a program reads back. CSV and JSON keep their own precision.
 */
export function weight(kg: number, u: Units, group = true): string {
  const v = u === "imperial" ? kg * LB_PER_KG : kg;
  const tenth = Math.round(v * 10) / 10;
  const n = Math.abs(tenth) < 100 ? String(tenth) : group ? groupDigits(Math.round(v)) : String(Math.round(v));
  return `${n} ${u === "imperial" ? "lb" : "kg"}`;
}

/** A mass given in pounds (freight weights are in lb), shown by the same rule as every other mass. */
export const weightFromLb = (lb: number, u: Units): string => weight(lb / LB_PER_KG, u);

/** Whole units only ("16 kg"): for change notes, where the point is the size of the move. */
export function weightWhole(kg: number, u: Units): string {
  return u === "imperial" ? `${groupDigits(Math.round(kg * LB_PER_KG))} lb` : `${groupDigits(Math.round(kg))} kg`;
}

/** A number with thousands separators ("30,000"), for a quantity shown beside its unit. */
export const groupDigits = (n: number): string => n.toLocaleString("en-US");

/** A single part's mass: the same rule as every other mass. */
export const partWeight = weight;

export function volume(m3: number, u: Units): string {
  return u === "imperial" ? `${(m3 * FT3_PER_M3).toFixed(1)} ft³` : `${m3.toFixed(2)} m³`;
}

export function area(m2: number, u: Units): string {
  return u === "imperial" ? `${Math.round(m2 * FT2_PER_M2)} ft²` : `${m2.toFixed(1)} m²`;
}

export function run(m: number, u: Units): string {
  return u === "imperial" ? `${Math.round(m * FT_PER_M)} ft` : `${m.toFixed(1)} m`;
}

/** Floor grid spacing in mm: 500 mm, or 1 ft. */
export const gridStepMm = (u: Units) => (u === "imperial" ? 304.8 : 500);
