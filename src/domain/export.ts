import type { Assembly, CrateDesign } from "./crate";
import type { DesignPart } from "./schema";
import { describeShipment, shipmentBom, type ShipmentPlan } from "./shipment";

export const ASSEMBLY_NAMES: Record<Assembly, string> = {
  base: "Base",
  sides: "Side walls",
  ends: "End walls",
  lid: "Lid",
  inside: "Inside the crate",
};

/** Cut list as CSV, for the shop floor. Always metric: the shop saws to these numbers. */
export function bomToCsv(part: DesignPart, design: CrateDesign): string {
  const { layout } = design;
  const header = [
    `# Crate for ${layout.slots.length} x ${part.id} ${part.name}`,
    `# Part ${part.material ?? "material not given"}, ${+part.mass_kg.toFixed(2)} kg each`,
    `# External ${layout.external.map(Math.round).join(" x ")} mm, gross ${Math.round(design.grossKg)} kg`,
    `# Layout ${layout.counts.join(" x ")}, ${layout.orientation.label}`,
    "component,material,stock,cut_mm,qty",
  ];
  const rows = design.bom.map((l) =>
    [`${ASSEMBLY_NAMES[l.assembly]}: ${l.label}`, l.material, l.stock, l.cutMm.join(" x "), l.qty].map(csvCell).join(","),
  );
  return [...header, ...rows, `Wood screws (approx),fastener,,,${design.screws}`].join("\n") + "\n";
}

/**
 * Cut list for every crate of a split batch (#25): each crate type's pieces × its count,
 * equal pieces merged. Same columns as `bomToCsv`.
 */
export function shipmentToCsv(part: DesignPart, plan: ShipmentPlan): string {
  const all = shipmentBom(plan);
  const header = [
    `# Shipment of ${plan.totals.parts} x ${part.id} ${part.name}: ${describeShipment(plan).replace(/×/g, "x")}`,
    `# Part ${part.material ?? "material not given"}, ${+part.mass_kg.toFixed(2)} kg each`,
    `# ${plan.totals.crates} crates, gross ${Math.round(plan.totals.grossKg)} kg in all; quantities are for every crate`,
    "component,material,stock,cut_mm,qty",
  ];
  const rows = all.lines.map((l) =>
    [`${ASSEMBLY_NAMES[l.assembly]}: ${l.label}`, l.material, l.stock, l.cutMm.join(" x "), l.qty].map(csvCell).join(","),
  );
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
