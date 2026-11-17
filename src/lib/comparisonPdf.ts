/**
 * The comparison summary (`Comparison`, spec §7.17) as a one-sheet PDF: the part, a table with a
 * row per configuration, the recommendation with its rationale and the constraint that stopped a
 * larger crate, and the cost notes. Uses the export PDF's writer (`exportPdf.ts`), so it has the
 * same header, footer, fonts and engine stamp. Loaded only with `import()`.
 */
import type { Comparison, ComparisonRow } from "./comparison";
import { CW, GREY, M, twoCols, Writer } from "./exportPdf";

const COLUMNS: { title: string; w: number; cell: (r: ComparisonRow) => string }[] = [
  { title: "Configuration", w: 92, cell: (r) => r.label },
  { title: "Per crate", w: 40, cell: (r) => r.perCrate },
  { title: "Crates", w: 32, cell: (r) => r.crates },
  { title: "Outside", w: 92, cell: (r) => r.outside },
  { title: "Gross each", w: 52, cell: (r) => r.gross },
  { title: "Cost / part", w: 50, cell: (r) => r.costPerPart },
  { title: "Notes", w: 0, cell: (r) => r.note },
];
const GAP = 6;
const widths = () => {
  const fixed = COLUMNS.reduce((s, c) => s + c.w + GAP, 0) - GAP;
  return COLUMNS.map((c) => c.w || CW - fixed);
};

function table(w: Writer, rows: ComparisonRow[]) {
  const ws = widths();
  const xs = ws.map((_, i) => M + ws.slice(0, i).reduce((s, v) => s + v + GAP, 0));
  const header = () => {
    COLUMNS.forEach((c, i) => w.textAt(c.title.toUpperCase(), w.y, { x: xs[i], w: ws[i], size: 7, style: "bold", gray: GREY }));
    w.y += 12;
    w.rule(w.y - 2);
  };
  w.ensure(40);
  header();
  for (const r of rows) {
    const style = r.recommended ? "bold" : "normal";
    const h = Math.max(...COLUMNS.map((c, i) => w.height(c.cell(r), { w: ws[i], size: 8, style }))) + 4;
    w.ensure(h);
    COLUMNS.forEach((c, i) => w.textAt(c.cell(r), w.y, { x: xs[i], w: ws[i], size: 8, style }));
    w.y += h;
    w.pdf.setDrawColor(210);
    w.pdf.setLineWidth(0.4);
    w.pdf.line(M, w.y - 2, M + CW, w.y - 2);
  }
  w.y += 8;
}

/** The comparison as PDF bytes (starting `%PDF-`). */
export function comparisonToPdf(doc: Comparison): Uint8Array {
  const w = new Writer(doc, "Comparison of crate configurations");
  w.sheet("Comparison · PM and logistics");
  if (doc.part.length) twoCols(w, { title: "Part", rows: doc.part }, null);
  w.h2("Configurations");
  table(w, doc.rows);
  if (doc.recommendation) {
    w.h2("Why this quantity");
    w.para(doc.recommendation.heading, { style: "bold" }, 2);
    w.para(doc.recommendation.rationale);
    if (doc.recommendation.stoppedBy) w.para(`Constraint that stopped a larger crate: ${doc.recommendation.stoppedBy}`);
  }
  w.y += 4;
  for (const n of doc.notes) w.para(n, { size: 8, gray: GREY });
  return w.finish();
}
