import type { BomLine } from "@/domain/crate";
import type { Layout } from "@/domain/packing";
import { lumberText, plywoodText } from "./lumber";
import { cut, type Units } from "./units";

/**
 * Metric: "19 × 89 lumber", "12 mm plywood". Imperial uses shop names (#15): "1x4",
 * "1/2″ plywood", and "1 15/16″ × 3 1/2″ from 4x4" for blocking cut to the gap.
 */
export function stockText(l: Pick<BomLine, "material" | "kind" | "stockMm">, u: Units): string {
  if (l.material === "plywood") return u === "imperial" ? `${plywoodText(l.stockMm[0])} plywood` : `${l.stockMm[0]} mm plywood`;
  return u === "imperial" ? lumberText(l.stockMm, l.kind) : `${l.stockMm.join(" × ")} lumber`;
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
