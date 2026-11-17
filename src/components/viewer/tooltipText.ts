import type { BomLine } from "@/domain/crate";
import { cutText, stockText } from "@/lib/format";
import { lengthUnit, type Units } from "@/lib/units";

/**
 * The second line of a board's hover tooltip: the stock, the cut and how many are in the crate,
 * e.g. `1/2″ plywood, cut 35 7/16″ × 25 1/4″. 2 in this crate`. Imperial cuts carry their own inch
 * mark; metric cuts are bare numbers, so they get the unit once at the end.
 *
 * This is display formatting that belongs with the other text helpers in `src/lib/format.ts`;
 * it is here until that module is free to take it.
 */
export function boardTooltipDetail(line: BomLine, units: Units): string {
  const unit = units === "metric" ? ` ${lengthUnit(units)}` : "";
  return `${stockText(line, units)}, cut ${cutText(line, units)}${unit}. ${line.qty} in this crate`;
}
