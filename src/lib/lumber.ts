/**
 * US shop names for stock (#15): nominal lumber ("2x4") and plywood by its sold thickness
 * ("3/4″"). Display and export only; the domain keeps sections in mm (spec §4).
 */
import type { MemberKind } from "@/domain/crate";
import { fraction } from "./units";

/** Surfaced (S4S) lumber: nominal name and actual size in mm, thinner side first. */
export const NOMINAL_LUMBER: readonly { name: string; mm: readonly [number, number] }[] = [
  { name: "1x2", mm: [19, 38] },
  { name: "1x3", mm: [19, 64] },
  { name: "1x4", mm: [19, 89] },
  { name: "1x6", mm: [19, 140] },
  { name: "1x8", mm: [19, 184] },
  { name: "1x10", mm: [19, 235] },
  { name: "1x12", mm: [19, 286] },
  { name: "2x2", mm: [38, 38] },
  { name: "2x3", mm: [38, 64] },
  { name: "2x4", mm: [38, 89] },
  { name: "2x6", mm: [38, 140] },
  { name: "2x8", mm: [38, 184] },
  { name: "2x10", mm: [38, 235] },
  { name: "2x12", mm: [38, 286] },
  { name: "4x4", mm: [89, 89] },
  { name: "4x6", mm: [89, 140] },
  { name: "4x8", mm: [89, 184] },
  { name: "6x6", mm: [140, 140] },
  { name: "6x8", mm: [140, 184] },
];

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

/** A millimetre either way: sizes are rounded to whole mm, and 1x4 is really 19.05 × 88.9. */
const TOLERANCE_MM = 1;

const sorted = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/** "2x4" for a 38 × 89 section (either order), or null when it isn't stock. */
export function nominalLumber(a: number, b: number): string | null {
  const [t, w] = sorted(a, b);
  const hit = NOMINAL_LUMBER.find((n) => Math.abs(n.mm[0] - t) <= TOLERANCE_MM && Math.abs(n.mm[1] - w) <= TOLERANCE_MM);
  return hit?.name ?? null;
}

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
