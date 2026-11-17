import { shipmentBom, type ShipmentPlan } from "@/domain/shipment";
import { groupThousands, hoursText, usdCents } from "./format";
import { area, groupDigits, run, volume, weight, weightFromLb, type Units } from "./units";

/**
 * The whole shipment in words, for the files and the header (#140): one set of figures with one
 * wording and thousands separators, so the shipment CSV, the PDF and print, the README and the page
 * never describe a total differently. Every figure is the plan's own (`plan.totals`, `shipmentBom`):
 * for a job's total quantity that is the crates of the split times their counts, not the 200-part
 * plan on screen.
 */
export interface ShipmentFigures {
  crates: string;
  parts: string;
  gross: string;
  volume: string;
  plywood: string;
  lumber: string;
  /** Plywood sheets to buy for every crate (#107): the pieces' area by thickness summed, plus the waste allowance. */
  sheets: string;
  screws: string;
  /** Wood, screws and labour for every crate, in dollars and cents. */
  cost: string;
  labour: string;
  /** Dimensional weight of every crate, summed. */
  dimWeight: string;
  /** "A class 85 (1,234 lb gross each) · B class 85 (1,200 lb gross each)": the freight class of each crate type. */
  freight: string;
}

/** The plan's whole-shipment figures in `u`. Crate types without a design are left out of `freight`. */
export function shipmentFigures(plan: ShipmentPlan, u: Units): ShipmentFigures {
  const { totals } = plan;
  const bom = shipmentBom(plan);
  const types = plan.crates.flatMap((t) => (t.result.design ? [{ label: t.label, design: t.result.design }] : []));
  return {
    crates: groupDigits(totals.crates),
    parts: groupDigits(totals.parts),
    gross: weight(totals.grossKg, u),
    volume: volume(totals.volumeM3, u),
    plywood: groupThousands(area(bom.plywoodM2, u)),
    lumber: groupThousands(run(bom.lumberM, u)),
    sheets: `~${groupDigits(bom.sheets.total)}`,
    screws: `~${groupDigits(bom.screws)}`,
    cost: usdCents(totals.costUsd),
    labour: groupThousands(hoursText(totals.labourHours)),
    dimWeight: weightFromLb(totals.dimWeightLb, u),
    freight: types.map((t) => `${t.label} class ${t.design.freight.freightClass} (${weight(t.design.grossKg, u)} gross each)`).join(" · "),
  };
}
