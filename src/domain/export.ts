import { lumberText, plywoodText } from "@/lib/lumber";
import { formatMass } from "@/lib/partFields";
import { dims, fraction, lengthUnit, weight, type Units } from "@/lib/units";
import type { Assembly, BomLine, CrateDesign } from "./crate";
import type { DesignPart } from "./schema";
import { describeShipment, shipmentBom, type ShipmentPlan } from "./shipment";

export const ASSEMBLY_NAMES: Record<Assembly, string> = {
  base: "Base",
  sides: "Side walls",
  ends: "End walls",
  lid: "Lid",
  inside: "Inside the crate",
};

/*
 * Cut lists as CSV for the shop floor, in the selected units (#15). This is an export edge,
 * so it formats with `src/lib` like the UI; the design itself stays in mm and kg (spec §4,
 * §7.6). Imperial is plain ASCII so spreadsheets don't garble it: cuts as "35 7/16 in", stock
 * by nominal name ("2x4", "3/4 in" plywood). Metric is whole mm and kg, as before.
 * The build sheet (#26) should follow the same rule and reuse these formatters.
 */

const UNITS_LINE: Record<Units, string> = {
  imperial: "# Units: inches (cuts to the nearest 1/16) and pounds; lumber by nominal size",
  metric: "# Units: mm and kg",
};

const columns = (u: Units) => `component,material,stock,cut_${lengthUnit(u)},qty`;

/** One part's mass: "21.5 kg" or "47.4 lb", to 2 decimals. */
const partMass = (kg: number, u: Units) => (u === "imperial" ? `${formatMass(kg, u)} lb` : `${+kg.toFixed(2)} kg`);

const ascii = (s: string) => s.replace(/ × /g, " x ");

function csvRow(l: BomLine, u: Units): string {
  const imperial = u === "imperial";
  const stock = !imperial
    ? l.stock
    : l.material === "plywood"
      ? plywoodText(l.stockMm[0], " in")
      : lumberText(l.stockMm, l.kind, " in");
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
 * Cut list for every crate of a split batch (#25): each crate type's pieces × its count,
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

export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
