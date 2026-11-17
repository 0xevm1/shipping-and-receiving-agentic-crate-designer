import type { BomLine } from "@/domain/crate";
import type { Layout } from "@/domain/packing";
import { cut, fraction, type Units } from "./units";

/** "19 × 89 lumber", "12 mm plywood", or the imperial equivalents. */
export function stockText(l: BomLine, u: Units): string {
  if (l.material === "plywood") return u === "imperial" ? `${fraction(l.stockMm[0])} plywood` : `${l.stockMm[0]} mm plywood`;
  const section = u === "imperial" ? l.stockMm.map(fraction).join(" × ") : l.stockMm.join(" × ");
  return `${section} lumber`;
}

export function cutText(l: BomLine, u: Units): string {
  return l.cutMm.map((v) => cut(v, u)).join(" × ");
}

/** "2 × 2, one layer", "4 in a row", "1 per layer, 2 layers". */
export function describeLayout(l: Layout): string {
  const [nx, ny, nz] = l.counts;
  if (l.slots.length === 1) return "Single part";
  if (nz > 1) return `${nx * ny === 1 ? "1" : `${nx} × ${ny}`} per layer, ${nz} layers`;
  return ny === 1 ? `${nx} in a row` : `${nx} × ${ny}, one layer`;
}

export function layoutName(l: Layout): string {
  return describeLayout(l) + (l.orientation.id === "as-modeled" ? "" : `, ${l.orientation.label.toLowerCase()}`);
}
