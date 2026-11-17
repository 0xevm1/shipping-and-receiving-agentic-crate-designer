/**
 * US shop names for stock: nominal lumber ("2x4") and plywood by its sold thickness
 * ("3/4″"). Display and export only; the domain keeps sections in mm (spec §4) and owns the
 * nominal-lumber table (`domain/lumber.ts`), which this file only formats.
 */
import type { MemberKind } from "@/domain/crate";
import { NOMINAL_LUMBER, nominalLumber, TOLERANCE_MM } from "@/domain/lumber";
import { fraction, type Units } from "./units";

/** Plywood as sold in the US: the nominal fraction for each metric thickness. */
const NOMINAL_PLYWOOD: Readonly<Record<number, string>> = {
  6: "1/4",
  9: "3/8",
  12: "1/2",
  15: "5/8",
  16: "5/8",
  18: "3/4",
  19: "3/4",
  25: "1",
};

const sorted = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/** The smallest stock section a piece of this size can be ripped from, or null. */
function sourceStock(a: number, b: number): string | null {
  const [t, w] = sorted(a, b);
  const fits = NOMINAL_LUMBER.filter((n) => n.mm[0] >= t - TOLERANCE_MM && n.mm[1] >= w - TOLERANCE_MM);
  if (!fits.length) return null;
  return fits.reduce((p, q) => (q.mm[0] * q.mm[1] < p.mm[0] * p.mm[1] ? q : p)).name;
}

/** "3/4″" for 19 mm plywood; other thicknesses to the nearest 1/16. */
export function plywoodText(mm: number, mark = "″"): string {
  const nominal = NOMINAL_PLYWOOD[Math.round(mm)];
  return nominal ? `${nominal}${mark}` : fraction(mm, mark);
}

/** Plywood by the thickness it is sold as ("1/2″" in imperial) or in mm ("12 mm"): the one label the app shows. */
export const plywoodLabel = (mm: number, u: Units): string => (u === "imperial" ? plywoodText(mm) : `${mm} mm`);

/** A lumber section by shop name in imperial ("2x4", else fractional inches), "38 × 89" in metric. */
export const sectionLabel = (a: number, b: number, u: Units): string => (u === "imperial" ? sectionText(a, b) : `${a} × ${b}`);

/** A section in fractional inches: "1″ × 3 15/16″" (or "1 in x 3 15/16 in" in the CSV). */
function inches(a: number, b: number, mark: string): string {
  return `${fraction(a, mark)}${mark === "″" ? " × " : " x "}${fraction(b, mark)}`;
}

/** A lumber section for the Overview: "1x4", or fractional inches when it isn't stock. */
export function sectionText(a: number, b: number, mark = "″"): string {
  return nominalLumber(a, b) ?? inches(a, b, mark);
}

/**
 * Lumber stock for the cut list: the nominal name ("4x4"). Blocking, bearers and cradles are cut to
 * the gap, so they read as their size and the stock they come from ("1 15/16″ × 3 1/2″ from
 * 4x4"). Any other size that isn't stock (custom shop standards) is fractional inches.
 */
export function lumberText(stockMm: readonly number[], kind: MemberKind, mark = "″"): string {
  const [a, b] = stockMm;
  const name = nominalLumber(a, b);
  if (name) return name;
  const size = inches(...sorted(a, b), mark);
  if (kind !== "blocking" && kind !== "bearer" && kind !== "cradle") return size;
  const from = sourceStock(a, b);
  return from ? `${size} from ${from}` : size;
}
