import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { planShipment } from "@/domain/shipment";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { pdfSafe, printableToPdf } from "./exportPdf";
import { buildPrintable } from "./printable";
import type { Units } from "./units";

const NOW = "2026-11-16T12:00:00.000Z";
const bracket = getPart("PART-001");

function pdf(quantity: number, units: Units = "imperial") {
  const plan = planShipment(bracket, { ...DEFAULT_SETTINGS, quantity }, null, DEFAULT_STANDARDS);
  const doc = buildPrintable({ part: bracket, plan, standards: DEFAULT_STANDARDS, units, generatedAt: NOW });
  const bytes = printableToPdf(doc);
  // The PDF is written uncompressed, so its text can be read back as Latin-1.
  return { doc, bytes, text: new TextDecoder("latin1").decode(bytes) };
}

/** Page objects ("/Type /Page", not "/Pages"). */
const pages = (text: string) => text.match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
/** Whether the PDF shows `s`: a text string starting with it. */
const shows = (text: string, s: string) => text.includes(`(${s}`);

describe("Export PDF (#51)", () => {
  it("is a real PDF of the crate spec, the build sheet and the label", () => {
    const { bytes, text } = pdf(4);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // Spec, drawings, cut list (the assembly order runs onto a fourth page), label.
    expect(pages(text)).toBe(5);
    expect(text).toContain("/Title (Crate for 4 × Machined steel bracket)");
    for (const s of ["CRATE SPEC · PM AND LOGISTICS", "BUILD SHEET · SHOP", "PART NUMBER", "THIS SIDE UP", "FORK ENTRY FROM THE ENDS"]) {
      expect(shows(text, s), s).toBe(true);
    }
  });

  it("carries every section of the print route", () => {
    const { doc, text } = pdf(4);
    const [c] = doc.crates;
    // Crate spec: rows, freight, layout rationale, checks.
    for (const s of ["SIZE AND WEIGHT", "FREIGHT", "LAYOUT", "CHECKS", "Freight class", "Dimensional weight"]) expect(shows(text, s), s).toBe(true);
    expect(text).toContain("The recommended layout is");
    for (const k of c.spec.checks) expect(shows(text, k.levelText.toUpperCase()), k.id).toBe(true);
    // Build sheet: drawing captions, cut list by stock, fasteners, assembly order.
    for (const d of c.build.drawings) expect(text, d.title).toContain(pdfSafe(d.title).slice(0, 20));
    for (const s of ["PIECE", "ASSEMBLY", "FASTENERS", "ASSEMBLY ORDER", "Wood screws, about"]) expect(shows(text, s), s).toBe(true);
    for (const g of c.build.cutList) expect(shows(text, pdfSafe(g.stock)), g.stock).toBe(true);
    for (const st of c.build.steps) expect(text).toContain(`${st.n}. ${st.title}`);
    // Label.
    expect(shows(text, "PART-001")).toBe(true);
    expect(shows(text, "4 PCS")).toBe(true);
  });

  it("follows the selected units", () => {
    expect(pdf(4, "imperial").text).toContain("36 11/16 in");
    const metric = pdf(4, "metric").text;
    expect(metric).toContain("932 × 652 × 497 mm");
    expect(metric).toContain("Millimetres and kilograms");
  });

  it("has a spec section, build sheet and label for every crate type of a split batch", () => {
    const { doc, text } = pdf(200);
    expect(doc.crates).toHaveLength(2);
    expect(shows(text, "Ships as 6 × crate A")).toBe(true);
    for (const l of ["A", "B"]) {
      expect(text).toContain(`BUILD SHEET · CRATE ${l}`);
      expect(text).toContain(`CRATE ${l} · `);
    }
    // Spec (two pages) + 2 × (drawings, cut list and assembly over two pages, label).
    expect(pages(text)).toBe(10);
  });

  it("spells characters the built-in fonts can't show", () => {
    expect(pdfSafe("1/2″ plywood – ≥ 3 → ok")).toBe("1/2 in plywood - >= 3 -> ok");
    expect(pdfSafe("36 × 25 · 3 ft³")).toBe("36 × 25 · 3 ft³");
    expect(pdfSafe("中")).toBe("?");
  });
});
