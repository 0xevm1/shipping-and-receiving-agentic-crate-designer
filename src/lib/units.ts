/**
 * Display-only unit formatting. The domain stays in mm and kg (spec §4); these
 * helpers convert at the last moment for the metric / imperial toggle.
 */

export type Units = "metric" | "imperial";

const MM_PER_IN = 25.4;
const LB_PER_KG = 2.20462;
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

/** Shop measurements: inches to the nearest 1/16, e.g. 35 7/16″. */
export function fraction(mm: number): string {
  const sixteenths = Math.round((mm / MM_PER_IN) * 16);
  const whole = Math.floor(sixteenths / 16);
  let num = sixteenths % 16;
  let den = 16;
  while (num && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  if (!num) return `${whole}″`;
  return whole ? `${whole} ${num}/${den}″` : `${num}/${den}″`;
}

/** A cut or stock size: whole mm, or fractional inches. */
export function cut(mm: number, u: Units): string {
  return u === "imperial" ? fraction(mm) : String(Math.round(mm));
}

export function weight(kg: number, u: Units): string {
  return u === "imperial" ? `${Math.round(kg * LB_PER_KG)} lb` : `${Math.round(kg)} kg`;
}

/** A single part's mass: as given in metric (21.5 kg), rounded in imperial. */
export function partWeight(kg: number, u: Units): string {
  return u === "imperial" ? weight(kg, u) : `${kg} kg`;
}

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
