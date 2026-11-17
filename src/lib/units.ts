/**
 * Display-only unit formatting. The domain stays in mm and kg (spec §4); these
 * helpers convert at the last moment for the metric / imperial toggle.
 */

import { NOMINAL_LUMBER } from "@/domain/lumber";
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
  return `${weightNumber(kg, u, group)} ${u === "imperial" ? "lb" : "kg"}`;
}

/** The number of `weight`, without its unit ("47.4", "297"): for a field that has the unit beside it. */
export function weightNumber(kg: number, u: Units, group = true): string {
  const v = u === "imperial" ? kg * LB_PER_KG : kg;
  const tenth = Math.round(v * 10) / 10;
  return Math.abs(tenth) < 100 ? String(tenth) : group ? groupDigits(Math.round(v)) : String(Math.round(v));
}

/** A mass given in pounds (freight weights are in lb), shown by the same rule as every other mass. */
export const weightFromLb = (lb: number, u: Units): string => weight(lb / LB_PER_KG, u);

/** Whole units only ("16 kg"): for change notes, where the point is the size of the move. */
export function weightWhole(kg: number, u: Units): string {
  return u === "imperial" ? `${groupDigits(Math.round(kg * LB_PER_KG))} lb` : `${groupDigits(Math.round(kg))} kg`;
}

/** A number with thousands separators ("30,000"), for a quantity shown beside its unit. */
export const groupDigits = (n: number): string => n.toLocaleString("en-US");

/** A single part's mass: the same rule as every other mass (`weight`). */
export const partWeight = (kg: number, u: Units): string => weight(kg, u);

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

/* ---- Editing shop standards in the selected units -------------------------------------------- */

/**
 * What a number in the standards editor measures. The stored standards are always metric; a field
 * with one of these dimensions shows, accepts and steps in inches / lb / lb/ft³ / $/ft³ when the
 * app is imperial, and converts at the edge (`editUnit`). Quantities with no imperial convention in
 * the app (minutes, $/h, $/100, %, ×, degrees, counts, MPa) have no dimension and show as stored.
 */
export type Dimension = "length" | "lumber" | "plywood" | "mass" | "density" | "cost";

/** A field's display unit, step, and the two conversions between the stored value and what is typed. */
export interface EditUnit {
  /** The unit shown beside the input, or null to keep the field's own (metric) unit. */
  unit: string | null;
  /** Spinner / arrow-key step in the shown unit. */
  step: number | "any";
  /** Stored (metric) value to the number shown in the input. */
  show: (stored: number) => number;
  /** The number typed to the stored (metric) value. */
  store: (shown: number) => number;
}

const KG_M3_PER_LB_FT3 = 16.0185;

/** Rounds to `digits` decimals, which also removes floating-point noise (2.5400000001). */
const round = (v: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

type Stock = readonly (readonly [mm: number, inches: number])[];

/** Plywood as sold: the actual mm of each nominal inch (the 3/4″ sheet is 19 mm). What typing stores. */
const PLYWOOD_STORE: Stock = [
  [6, 0.25],
  [9, 0.375],
  [12, 0.5],
  [15, 0.625],
  [19, 0.75],
  [25, 1],
];
/** What a stored thickness reads as: also the 16 and 18 mm sheets, sold as 5/8″ and 3/4″. */
const PLYWOOD_SHOW: Stock = [...PLYWOOD_STORE, [16, 0.625], [18, 0.75]];

/** Lumber as sold: each stock size in mm with its actual inches to the quarter (64 mm is 2 1/2″). */
const LUMBER_STOCK: Stock = [...new Set(NOMINAL_LUMBER.flatMap((n) => n.mm))]
  .sort((a, b) => a - b)
  .map((mm) => [mm, Math.round((mm / MM_PER_IN) * 4) / 4] as const);

/** Stock sizes keep their nominal inches both ways, so 3.5 in is exactly the 89 mm a 2x4 is. */
function stockUnit(showAs: Stock, storeAs: Stock, step: number): EditUnit {
  return {
    unit: "in",
    step,
    // Exact match only: 3.504 in typed is 89.002 mm and must read back as 3.504, not 3.5.
    show: (mm) => showAs.find(([n]) => Math.abs(n - mm) < 1e-6)?.[1] ?? round(mm / MM_PER_IN, 3),
    store: (inches) => storeAs.find(([, i]) => Math.abs(i - inches) < 1e-9)?.[0] ?? round(inches * MM_PER_IN, 3),
  };
}

/**
 * How to show, accept and step a standard of this dimension in these units. Imperial lengths are
 * inches to 2 decimals (stock sizes to 3), mass is lb to 2 decimals. Typing a number the editor can
 * show and saving it stores a metric value that shows as the same number, so a round trip does not drift.
 */
export function editUnit(dim: Dimension | undefined, u: Units): EditUnit {
  if (!dim || u === "metric") return { unit: null, step: "any", show: (v) => v, store: (v) => v };
  switch (dim) {
    case "length":
      return { unit: "in", step: 0.25, show: (mm) => round(mm / MM_PER_IN, 2), store: (inches) => round(inches * MM_PER_IN, 3) };
    case "lumber":
      return stockUnit(LUMBER_STOCK, LUMBER_STOCK, 0.25);
    case "plywood":
      return stockUnit(PLYWOOD_SHOW, PLYWOOD_STORE, 0.125);
    case "mass":
      return { unit: "lb", step: 1, show: (kg) => round(kg * LB_PER_KG, 2), store: (lb) => round(lb / LB_PER_KG, 4) };
    case "density":
      return { unit: "lb/ft³", step: 0.5, show: (kg) => round(kg / KG_M3_PER_LB_FT3, 2), store: (lb) => round(lb * KG_M3_PER_LB_FT3, 3) };
    case "cost":
      return { unit: "$/ft³", step: 0.25, show: (usd) => round(usd / FT3_PER_M3, 2), store: (usd) => round(usd * FT3_PER_M3, 3) };
  }
}
