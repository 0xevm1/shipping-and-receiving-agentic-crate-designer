/**
 * Text ↔ value helpers for the part header's inline fields (#40). The store and the domain
 * stay in kg; the mass field shows and accepts lb when imperial units are selected.
 */
import { LB_PER_KG, type Units } from "./units";

export const massUnit = (u: Units) => (u === "imperial" ? "lb" : "kg");

/** Rounds away floating-point noise: 14.709999 → 14.71. */
const tidyNumber = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/**
 * The mass as the field shows it: the stored kg as entered (up to 3 decimals), or lb to
 * 2 decimals. No unit; the unit sits after the field.
 */
export function formatMass(kg: number, u: Units): string {
  return u === "imperial" ? String(tidyNumber(kg * LB_PER_KG, 2)) : String(tidyNumber(kg, 3));
}

export type MassParse = { ok: true; kg: number } | { ok: false; error: string };

/**
 * Reads the mass field: a positive decimal in the selected unit, with an optional trailing
 * unit ("12.5 kg", "30 lb") and a comma accepted as the decimal mark. Lb is converted to kg
 * (to 0.1 g). The error is one short line for under the field.
 */
export function parseMass(text: string, u: Units): MassParse {
  const unit = massUnit(u);
  const t = text
    .trim()
    .replace(/\s*(kgs?|lbs?)\.?$/i, "")
    .replace(",", ".");
  if (t === "") return { ok: false, error: `Enter the mass of one part in ${unit}.` };
  if (!/^\+?(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false, error: `Enter a number of ${unit}, like 12.5.` };
  const value = Number(t);
  if (!(value > 0) || !Number.isFinite(value)) return { ok: false, error: `Mass must be more than 0 ${unit}.` };
  const kg = u === "imperial" ? tidyNumber(value / LB_PER_KG, 4) : value;
  if (!(kg > 0)) return { ok: false, error: `Mass must be more than 0 ${unit}.` };
  return { ok: true, kg };
}

/**
 * ↑ / ↓ on the mass field: 0.1 of the shown unit, or 1 with Shift. Steps from the value as
 * shown, so the field never jumps by a conversion remainder, and never goes below one step.
 * Returns the new mass in kg.
 */
export function stepMass(kg: number, direction: 1 | -1, big: boolean, u: Units): number {
  const step = big ? 1 : 0.1;
  const shown = Number(formatMass(kg, u));
  const next = Math.max(step, tidyNumber(shown + direction * step, 3));
  // Already at (or under) the floor: stay put rather than round-trip the conversion.
  if (next === shown || (direction < 0 && next > shown)) return kg;
  return u === "imperial" ? tidyNumber(next / LB_PER_KG, 4) : next;
}

/**
 * Width in `ch` for browsers without `field-sizing: content`: the longer of the text and the
 * placeholder, plus room for the caret, kept between `min` and `max`.
 */
export function fieldWidthCh(text: string, placeholder: string, min: number, max: number): number {
  const len = Math.max(text.length, text ? 0 : placeholder.length);
  return Math.min(max, Math.max(min, len + 1));
}
