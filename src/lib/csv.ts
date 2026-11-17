import { ASSEMBLY_NAMES } from "@/domain/crate";
import type { BomLine, CrateDesign } from "@/domain/crate";
import type { DesignPart } from "@/domain/schema";
import { describeShipment, shipmentBom, type ShipmentPlan } from "@/domain/shipment";
import { lumberText, plywoodText } from "./lumber";
import { formatMass } from "./partFields";
import { dims, fraction, lengthUnit, weight, type Units } from "./units";

/*
 * Cut lists as CSV for the shop floor, in the selected units. This is an export edge, so it
 * formats with the same helpers as the UI; the design itself stays in mm and kg (spec §4,
 * §7.6). Imperial is plain ASCII so spreadsheets don't garble it: cuts as "35 7/16 in", stock
 * by nominal name ("2x4", "3/4 in" plywood). Metric is whole mm and kg.
 */

const UNITS_LINE: Record<Units, string> = {
  imperial: "# Units: inches (cuts to the nearest 1/16) and pounds; lumber by nominal size",
  metric: "# Units: mm and kg",
};

const columns = (u: Units) => `component,material,stock,cut_${lengthUnit(u)},qty`;

/** One part's mass as CSV data, to 2 decimals ("21.5 kg", "47.4 lb"); the display rule (`weight`) is for screens and documents. */
const partMass = (kg: number, u: Units) => (u === "imperial" ? `${formatMass(kg, u)} lb` : `${+kg.toFixed(2)} kg`);

const ascii = (s: string) => s.replace(/ × /g, " x ");

function csvRow(l: BomLine, u: Units): string {
  const imperial = u === "imperial";
  const stock = !imperial ? l.stock : l.material === "plywood" ? plywoodText(l.stockMm[0], " in") : lumberText(l.stockMm, l.kind, " in");
  const cut = l.cutMm.map((v) => (imperial ? fraction(v, " in") : String(v))).join(" x ");
  return [`${ASSEMBLY_NAMES[l.assembly]}: ${l.label}`, l.material, stock, cut, l.qty].map(csvCell).join(",");
}

/** Cut list for the crate on screen. */
export function bomToCsv(part: DesignPart, design: CrateDesign, u: Units): string {
  const { layout } = design;
  const header = [
    `# Crate for ${layout.slots.length} x ${part.id} ${part.name}`,
    `# Part ${part.material ?? "material not given"}, ${partMass(part.mass_kg, u)} each`,
    `# External ${ascii(dims(layout.external, u))} ${lengthUnit(u)}, gross ${weight(design.grossKg, u)}`,
    `# Layout ${layout.counts.join(" x ")}, ${layout.orientation.label}`,
    UNITS_LINE[u],
    columns(u),
  ];
  const rows = design.bom.map((l) => csvRow(l, u));
  return [...header, ...rows, `Wood screws (approx),fastener,,,${design.screws}`].join("\n") + "\n";
}

/**
 * Cut list for every crate of a split batch (spec §7.13): each crate type's pieces × its count,
 * equal pieces merged. Same columns as `bomToCsv`.
 */
export function shipmentToCsv(part: DesignPart, plan: ShipmentPlan, u: Units): string {
  const all = shipmentBom(plan);
  const header = [
    `# Shipment of ${plan.totals.parts} x ${part.id} ${part.name}: ${describeShipment(plan).replace(/×/g, "x")}`,
    `# Part ${part.material ?? "material not given"}, ${partMass(part.mass_kg, u)} each`,
    `# ${plan.totals.crates} crates, gross ${weight(plan.totals.grossKg, u)} in all; quantities are for every crate`,
    UNITS_LINE[u],
    columns(u),
  ];
  const rows = all.lines.map((l) => csvRow(l, u));
  return [...header, ...rows, `Wood screws (approx),fastener,,,${all.screws}`].join("\n") + "\n";
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
