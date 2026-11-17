import type { Sheet, SheetsNeeded } from "@/domain/sheets";
import { MM_PER_FT } from "@/domain/units";
import { plywoodLabel, plywoodText } from "./lumber";
import { fraction, length, type Units } from "./units";

/** Plywood sheet counts as text, in the selected units (spec §7.5c). */

/** "4 × 8 ft" for a sheet cut to whole feet, else inches; "1220 × 2440 mm" in metric. */
export function sheetSizeText(s: Sheet, u: Units): string {
  const sides = [s.width, s.length];
  if (u === "metric") return `${sides.map((v) => length(v, u)).join(" × ")} mm`;
  const feet = sides.map((v) => v / MM_PER_FT);
  return feet.every((f) => Math.abs(f - Math.round(f)) < 0.01) ? `${feet.map(Math.round).join(" × ")} ft` : `${sides.map((v) => length(v, u)).join(" × ")} in`;
}

/** "~7": an estimate to buy by, not a cutting plan. */
export const sheetsTotal = (s: SheetsNeeded): string => `~${s.total}`;

/** How the count was made: "1/2″: 2, 3/4″: 3 of 4 × 8 ft sheets (piece area + 15% waste, no nesting)". */
export function sheetsHint(s: SheetsNeeded, u: Units): string {
  const by = s.lines.map((l) => `${plywoodLabel(l.thicknessMm, u)}: ${l.sheets}`).join(", ");
  return `${by} of ${sheetSizeText(s.sheetMm, u)} sheets (piece area + ${Math.round(s.allowance * 100)}% waste, no nesting)`;
}

/** CSV rows for the sheet count: one per plywood thickness, the cut column holding the sheet size. */
export function sheetRows(s: SheetsNeeded, u: Units): string[] {
  const imperial = u === "imperial";
  const cut = [s.sheetMm.width, s.sheetMm.length].map((v) => (imperial ? fraction(v, " in") : String(v))).join(" x ");
  return s.lines.map((l) => `Plywood sheets (approx),plywood,${imperial ? plywoodText(l.thicknessMm, " in") : `${l.thicknessMm} mm`},${cut},${l.sheets}`);
}
