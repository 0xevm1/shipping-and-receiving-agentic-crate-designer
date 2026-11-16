import type { CrateDesign } from "./crate";
import type { Part } from "./schema";

/** Cut list as CSV, for the shop floor. */
export function bomToCsv(part: Part, design: CrateDesign): string {
  const [L, W, H] = design.layout.external.map(Math.round);
  const header = [
    `# Crate for ${design.layout.slots.length} × ${part.id} ${part.name}`,
    `# External ${L} × ${W} × ${H} mm, gross ${design.grossKg.toFixed(1)} kg`,
    "component,material,stock,cut_mm,qty",
  ];
  const rows = design.bom.map((l) => [l.kind, l.material, l.stock, l.cut, l.qty].map(csvCell).join(","));
  return [...header, ...rows, `fasteners,wood screws,,,${design.screws}`].join("\n");
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
  a.click();
  URL.revokeObjectURL(url);
}
