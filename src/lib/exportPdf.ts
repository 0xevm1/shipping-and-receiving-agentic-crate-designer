/**
 * The export document as a real PDF file, for the Export pill's .zip.
 *
 * It lays out the same `PrintableDesign` the `/print` route renders, section for section:
 * crate spec (part, shipment plan, one section per crate type with size, weights, freight,
 * the layout and why it won, the runner-up and every check), then per crate type a build sheet
 * (the five drawings; the cut list by stock, fasteners and assembly order) and a shipping label.
 *
 * Everything is vector: text with the PDF's built-in Helvetica, and the drawings from
 * `crateDrawings` drawn as rectangles and lines here rather than through an SVG converter. The
 * drawings are only rectangles, hatching and dimension lines, so drawing them directly keeps the
 * PDF code DOM-free (it runs in Node for the unit tests) and avoids a second dependency.
 *
 * jsPDF is large, so this module is only ever loaded with `import()` when someone exports.
 */
import { jsPDF } from "jspdf";
import type { DimLine, Drawing, DrawingRect } from "./drawings";
import type { ExplanationText } from "./explanation";
import type { PrintableCrate, PrintableDesign, PrintableLabel, PrintableQuantity, PrintableStamp, Row } from "./printable";

/** US Letter in points, with the print route's 0.5″ margins. */
const PAGE_W = 612;
const PAGE_H = 792;
export const M = 36;
export const CW = PAGE_W - 2 * M;
/** Room kept at the foot of every page for the page number. */
const FOOT = 22;
export const BOTTOM = PAGE_H - M - FOOT + 8;

const LH = 1.3;
export const GREY = 96;
const LIGHT = 236;

/**
 * The built-in PDF fonts are WinAnsi (Latin-1 plus a few). Characters outside it come out as
 * garbage, so the few the model uses are spelled in plain text; Latin-1 (×, ·, ³, ÷) is kept.
 */
const SPELL: Record<string, string> = {
  "″": " in",
  "′": "'",
  "–": "-",
  "—": "-",
  "−": "-",
  "→": "->",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "…": "...",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ",
};

export function pdfSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    const spelled = SPELL[ch];
    if (spelled !== undefined) out += spelled;
    else out += ch.charCodeAt(0) <= 0xff ? ch : "?";
  }
  // "1 1/2 in" written as `1 1/2″` becomes "1 1/2 in"; avoid "in in" and double spaces.
  return out.replace(/ in in\b/g, " in").replace(/ {2,}/g, " ");
}

type Style = "normal" | "bold" | "italic";

interface TextOpts {
  size?: number;
  style?: Style;
  x?: number;
  w?: number;
  gray?: number;
  align?: "left" | "right" | "center";
}

/** What every page's header and footer show; a `PrintableDesign` is one. */
export interface PdfHead {
  title: string;
  date: string;
  unitsNote: string;
  /** The engine's stamp: in the footer and the PDF's keywords. */
  stamp?: PrintableStamp;
  /** ISO time: the PDF's creation date (and, with the stamp, its file id), so equal inputs give equal bytes. */
  createdAt?: string;
}

/** "Engine 0.1.0+engine.5 · input 3f2a…", the footer and keywords line. */
export const stampText = (s: PrintableStamp) => `Engine ${s.engineVersion} · input ${s.inputHash}`;

/** A cursor over the pages, with the header of the sheet being written repeated on overflow. */
export class Writer {
  readonly pdf: jsPDF;
  y = M;
  private header: (() => void) | null = null;
  private first = true;

  constructor(
    readonly doc: PdfHead,
    subject = "Crate spec, build sheet and shipping label",
  ) {
    this.pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: false });
    this.pdf.setProperties({
      title: pdfSafe(doc.title),
      subject,
      creator: "Crate Designer",
      ...(doc.stamp ? { keywords: `engineVersion=${doc.stamp.engineVersion} inputHash=${doc.stamp.inputHash}` } : {}),
    });
    if (doc.createdAt) this.pdf.setCreationDate(new Date(doc.createdAt));
    // jsPDF's default file id is random; derive it from the stamp so the bytes are reproducible.
    if (doc.stamp) this.pdf.setFileId(doc.stamp.inputHash.slice(0, 32).toUpperCase());
    this.pdf.setLineHeightFactor(LH);
  }

  /** Starts a sheet on a new page; its header repeats on any page it overflows to. */
  sheet(kind: string | null) {
    if (!this.first) this.pdf.addPage("letter", "portrait");
    this.first = false;
    this.header = kind === null ? null : () => this.drawHeader(kind);
    this.y = M;
    this.header?.();
  }

  /** A page break when `h` more points don't fit. */
  ensure(h: number) {
    if (this.y + h <= BOTTOM) return;
    this.pdf.addPage("letter", "portrait");
    this.y = M;
    this.header?.();
  }

  font(size: number, style: Style = "normal", gray = 0) {
    this.pdf.setFont("helvetica", style);
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(gray);
  }

  lines(text: string, w: number): string[] {
    return this.pdf.splitTextToSize(pdfSafe(text), w) as string[];
  }

  /** Wrapped text at (x, y), top-aligned; returns its height. Doesn't move the cursor. */
  textAt(text: string, y: number, o: TextOpts = {}): number {
    const size = o.size ?? 9;
    const x = o.x ?? M;
    const w = o.w ?? CW;
    this.font(size, o.style, o.gray);
    const ls = this.lines(text, w);
    const ax = o.align === "right" ? x + w : o.align === "center" ? x + w / 2 : x;
    this.pdf.text(ls, ax, y, { baseline: "top", align: o.align ?? "left" });
    return ls.length * size * LH;
  }

  height(text: string, o: TextOpts = {}): number {
    const size = o.size ?? 9;
    this.font(size, o.style);
    return this.lines(text, o.w ?? CW).length * size * LH;
  }

  /** Wrapped text at the cursor, breaking the page first if it doesn't fit. */
  para(text: string, o: TextOpts = {}, after = 4) {
    this.ensure(this.height(text, o));
    this.y += this.textAt(text, this.y, o) + after;
  }

  h2(text: string) {
    this.ensure(48);
    this.y += 6;
    this.y += this.textAt(text, this.y, { size: 13, style: "bold" }) + 4;
  }

  h3(text: string, x = M, w = CW): number {
    const h = this.textAt(text.toUpperCase(), this.y, { size: 7.5, style: "bold", gray: GREY, x, w });
    return h + 3;
  }

  rule(y: number, x = M, w = CW, width = 0.5) {
    this.pdf.setDrawColor(0);
    this.pdf.setLineWidth(width);
    this.pdf.line(x, y, x + w, y);
  }

  private drawHeader(kind: string) {
    const { doc } = this;
    const metaW = 190;
    this.textAt(kind.toUpperCase(), M, { size: 7.5, style: "bold", gray: GREY, w: CW - metaW });
    const titleH = this.textAt(doc.title, M + 11, { size: 15, style: "bold", w: CW - metaW });
    this.textAt(`Crate Designer · ${doc.date}`, M, { size: 8, gray: GREY, x: M + CW - metaW, w: metaW, align: "right" });
    this.textAt(doc.unitsNote, M + 11, { size: 8, gray: GREY, x: M + CW - metaW, w: metaW, align: "right" });
    const bottom = Math.max(M + 11 + titleH, M + 34) + 4;
    this.rule(bottom, M, CW, 1);
    this.y = bottom + 10;
  }

  /** Page numbers, once every page exists. */
  finish(): Uint8Array {
    const n = this.pdf.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.pdf.setPage(i);
      this.textAt(`${this.doc.title} · page ${i} of ${n}`, PAGE_H - M - 6, { size: 7.5, gray: GREY, align: "right" });
      if (this.doc.stamp) this.textAt(stampText(this.doc.stamp), PAGE_H - M + 4, { size: 6, gray: GREY });
    }
    return new Uint8Array(this.pdf.output("arraybuffer"));
  }
}

/** Labelled rows (label, bold value, grey note) in a column; returns the height. */
function rows(w: Writer, list: Row[], x: number, colW: number, y: number, draw: boolean): number {
  const labelW = Math.min(118, colW * 0.42);
  const valueW = colW - labelW - 6;
  let h = 0;
  for (const r of list) {
    const lh = draw ? w.textAt(r.label, y + h, { x, w: labelW, gray: GREY }) : w.height(r.label, { w: labelW });
    let vh = draw ? w.textAt(r.value, y + h, { x: x + labelW + 6, w: valueW, style: "bold" }) : w.height(r.value, { w: valueW, style: "bold" });
    if (r.note) {
      vh += draw ? w.textAt(r.note, y + h + vh, { x: x + labelW + 6, w: valueW, size: 7.5, gray: GREY }) : w.height(r.note, { w: valueW, size: 7.5 });
    }
    h += Math.max(lh, vh) + 3;
  }
  return h;
}

/** Two columns of rows side by side, each under a small heading; moves the cursor below both. */
export interface Col {
  title: string;
  /** Sentences before and after the rows. */
  lead?: string[];
  rows: Row[];
  extra?: string[];
}

export function twoCols(w: Writer, left: Col, right: Col | null) {
  const colW = right ? (CW - 18) / 2 : CW;
  const col = (c: Col, x: number, draw: boolean) => {
    let h = draw ? w.h3(c.title, x, colW) : 12;
    for (const e of c.lead ?? []) h += (draw ? w.textAt(e, w.y + h, { x, w: colW, style: "bold" }) : w.height(e, { w: colW, style: "bold" })) + 4;
    h += rows(w, c.rows, x, colW, w.y + h, draw);
    for (const e of c.extra ?? []) h += (draw ? w.textAt(e, w.y + h, { x, w: colW }) : w.height(e, { w: colW })) + 3;
    return h;
  };
  const need = Math.max(col(left, M, false), right ? col(right, M + colW + 18, false) : 0);
  w.ensure(need);
  const h = Math.max(col(left, M, true), right ? col(right, M + colW + 18, true) : 0);
  w.y += h + 6;
}

function crateSpec(w: Writer, c: PrintableCrate, split: boolean) {
  // Keep the heading with its size, weight and freight rows.
  w.ensure(170);
  w.h2(split ? c.heading : "The crate");
  twoCols(w, { title: "Size and weight", rows: c.spec.rows }, { title: "Freight", rows: c.spec.freight });
  w.ensure(40);
  w.y += w.h3("Layout");
  w.para(`${c.spec.layout.chosen}.`, { style: "bold" }, 2);
  w.para(c.spec.layout.why);
  if (c.spec.layout.runnerUp) w.para(`Runner-up: ${c.spec.layout.runnerUp}`, { gray: GREY });
  w.ensure(30);
  w.y += w.h3("Checks");
  for (const k of c.spec.checks) {
    const text = `${k.title}. ${k.detail}`;
    const h = Math.max(w.height(text, { x: M + 56, w: CW - 56 }), 12);
    w.ensure(h + 4);
    w.textAt(k.levelText.toUpperCase(), w.y, { size: 7.5, style: "bold", gray: k.level === "ok" ? GREY : 0, w: 52 });
    w.textAt(text, w.y, { x: M + 56, w: CW - 56 });
    w.y += h + 2;
    w.pdf.setDrawColor(210);
    w.pdf.setLineWidth(0.4);
    w.pdf.line(M, w.y, M + CW, w.y);
    w.y += 3;
  }
}

/** The quantity per crate and why (spec §7.16): the recommendation, its rationale and what stopped a larger crate. */
function quantitySpec(w: Writer, q: PrintableQuantity) {
  w.ensure(120);
  w.h2(q.recommended ? "Quantity per crate" : "Quantity per crate (not the recommendation)");
  w.para(q.heading, { style: "bold" }, 2);
  w.para(q.rationale);
  twoCols(w, { title: "The sweep", rows: q.rows }, null);
  if (q.why) explanationPdf(w, q.why);
  // The explanation says it in "How it is scored".
  else if (q.costNote) w.para(q.costNote, { gray: GREY, size: 8 });
}

/**
 * "Why this crate?" as the Rules tab shows it (spec §7.16): each section's sentences, with the
 * recommended crate's cost and the best quantities after "How it is scored".
 */
export function explanationPdf(w: Writer, x: ExplanationText) {
  for (const s of x.sections) {
    w.ensure(48);
    w.y += w.h3(s.title);
    for (const line of s.lines) w.para(line);
    if (s.id === "score") {
      twoCols(
        w,
        { title: `Cost of ${x.quantity} per crate`, rows: x.costLines.map((l) => ({ label: l.label, value: l.value, note: l.detail ?? undefined })) },
        {
          title: "Best quantities, cost per part",
          rows: x.ranking.map((r) => ({ label: `${r.quantity} per crate`, value: r.perPart, note: r.picked ? "the recommendation" : `${r.vsPick} a part` })),
        },
      );
    }
  }
}

/** One drawing in a box, as `DrawingSvg` draws it: black on white, sections hatched, parts dashed. */
function drawing(w: Writer, d: Drawing, x0: number, y0: number, boxW: number, boxH: number): number {
  const { pdf } = w;
  const k = Math.max(d.width / (boxW - 46), d.height / (boxH - 34), 1e-6);
  const maxY = d.minY + d.height;
  const X = (mx: number) => x0 + 6 + (mx - d.minX) / k;
  const Y = (my: number) => y0 + 6 + (maxY - my) / k;

  const hatch = (r: { x: number; y: number; w: number; h: number }, step: number, dir: 1 | -1, width: number) => {
    pdf.setDrawColor(0);
    pdf.setLineWidth(width);
    const x1 = r.x;
    const x2 = r.x + r.w;
    const y1 = r.y;
    const y2 = r.y + r.h;
    if (dir === 1) {
      // Lines y = x + c.
      for (let c = y1 - x2 + step / 2; c < y2 - x1; c += step) {
        const xs = Math.max(x1, y1 - c);
        const xe = Math.min(x2, y2 - c);
        if (xe > xs) pdf.line(xs, xs + c, xe, xe + c);
      }
    } else {
      // Lines y = −x + c.
      for (let c = x1 + y1 + step / 2; c < x2 + y2; c += step) {
        const xs = Math.max(x1, c - y2);
        const xe = Math.min(x2, c - y1);
        if (xe > xs) pdf.line(xs, c - xs, xe, c - xe);
      }
    }
  };

  for (const r of d.rects) {
    const box = { x: X(r.x), y: Y(r.y + r.h), w: r.w / k, h: r.h / k };
    const fill = rectFill(r, d.section);
    pdf.setFillColor(fill.gray, fill.gray, fill.gray);
    pdf.rect(box.x, box.y, box.w, box.h, "F");
    if (fill.hatch)
      hatch(box, fill.hatch === "dense" ? 2.5 * Math.SQRT2 : 5 * Math.SQRT2, fill.hatch === "dense" ? -1 : 1, fill.hatch === "dense" ? 0.5 : 0.45);
    pdf.setDrawColor(0);
    pdf.setLineWidth(r.kind === "part" ? 0.8 : 0.5);
    if (r.kind === "part") pdf.setLineDashPattern([3, 2], 0);
    pdf.rect(box.x, box.y, box.w, box.h, "S");
    if (r.kind === "part") pdf.setLineDashPattern([], 0);
  }
  for (const dim of d.dims) dimension(w, dim, d, X, Y);
  return d.height / k + 34;
}

function rectFill(r: DrawingRect, section: boolean): { gray: number; hatch?: "hatch" | "dense" } {
  if (r.kind === "part") return { gray: 255 };
  if (r.kind === "dunnage") return { gray: 255, hatch: "dense" };
  if (section) return r.kind === "plywood" ? { gray: 189 } : { gray: 255, hatch: "hatch" };
  return { gray: r.kind === "plywood" ? 255 : LIGHT };
}

function dimension(w: Writer, dim: DimLine, d: Drawing, X: (mm: number) => number, Y: (mm: number) => number) {
  const { pdf } = w;
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  const tick = 3;
  w.font(8);
  const text = pdfSafe(dim.text);
  if (dim.side === "below") {
    const y = Y(d.minY) + 12;
    const a = X(dim.from);
    const b = X(dim.to);
    pdf.line(a, y, b, y);
    pdf.line(a, y - tick, a, y + tick);
    pdf.line(b, y - tick, b, y + tick);
    pdf.text(text, (a + b) / 2, y + 4, { align: "center", baseline: "top" });
    return;
  }
  const x = X(d.minX + d.width) + 12;
  const a = Y(dim.from);
  const b = Y(dim.to);
  pdf.line(x, a, x, b);
  pdf.line(x - tick, a, x + tick, a);
  pdf.line(x - tick, b, x + tick, b);
  // Reads top to bottom, as on the print page.
  const tw = pdf.getTextWidth(text);
  pdf.text(text, x + 5, (a + b) / 2 - tw / 2, { angle: -90 });
}

function buildSheet(w: Writer, doc: PrintableDesign, c: PrintableCrate) {
  const split = doc.shipment.split;
  const kind = split ? `Build sheet · crate ${c.letter} (build ${c.count})` : "Build sheet · shop";
  w.sheet(kind);
  w.y += w.textAt(c.heading, w.y, { size: 13, style: "bold" }) + 4;
  w.para(`${c.build.dimsNote}. Outside views, then sections through the load (parts dashed, cut boards hatched).`, { gray: GREY }, 8);
  const boxW = (CW - 12) / 2;
  const boxH = 168;
  c.build.drawings.forEach((d, i) => {
    const col = i % 2;
    const x = M + col * (boxW + 12);
    const used = drawing(w, d, x, w.y, boxW, boxH);
    w.textAt(d.title, w.y + Math.min(used, boxH) + 2, { x, w: boxW, size: 7.5, gray: GREY });
    if (col === 1 || i === c.build.drawings.length - 1) w.y += boxH + 26;
  });

  w.sheet(kind);
  w.h2(`Cut list by stock${split ? `, one crate ${c.letter}` : ""}`);
  const cols = { piece: M + 4, assembly: M + 200, cut: M + 330, qtyRight: M + CW - 4 };
  const head = () => {
    w.font(7.5, "bold", GREY);
    w.pdf.text("PIECE", cols.piece, w.y, { baseline: "top" });
    w.pdf.text("ASSEMBLY", cols.assembly, w.y, { baseline: "top" });
    w.pdf.text("CUT", cols.cut, w.y, { baseline: "top" });
    w.pdf.text("QTY", cols.qtyRight, w.y, { baseline: "top", align: "right" });
    w.y += 11;
    w.rule(w.y);
    w.y += 3;
  };
  w.ensure(30);
  head();
  for (const g of c.build.cutList) {
    w.ensure(28);
    w.pdf.setFillColor(LIGHT, LIGHT, LIGHT);
    w.pdf.rect(M, w.y - 1, CW, 13, "F");
    w.font(9, "bold");
    w.pdf.text(pdfSafe(g.stock), cols.piece, w.y + 1, { baseline: "top" });
    w.pdf.text(pdfSafe(g.total), cols.cut, w.y + 1, { baseline: "top" });
    w.pdf.text(String(g.pieces), cols.qtyRight, w.y + 1, { baseline: "top", align: "right" });
    w.y += 14;
    for (const l of g.lines) {
      w.ensure(12);
      w.font(9);
      w.pdf.text(pdfSafe(l.piece), cols.piece, w.y, { baseline: "top" });
      w.pdf.text(pdfSafe(l.assembly), cols.assembly, w.y, { baseline: "top" });
      w.pdf.text(pdfSafe(l.cut), cols.cut, w.y, { baseline: "top" });
      w.pdf.text(String(l.qty), cols.qtyRight, w.y, { baseline: "top", align: "right" });
      w.y += 11.5;
    }
  }
  w.rule(w.y);
  w.y += 5;
  w.para(c.build.totals.map((t) => `${t.value} ${t.label.toLowerCase()}`).join("   ·   "), { style: "bold" }, 2);
  for (const t of c.build.totals) if (t.note) w.para(`${t.label}: ${pdfSafe(t.note)}`, { size: 7.5, gray: GREY }, 2);
  w.y += 6;

  w.ensure(40);
  w.y += w.h3("Fasteners");
  for (const f of c.build.fasteners) {
    const h = w.height(f.rule, { size: 7.5, w: CW - 60 }) + 11;
    w.ensure(h);
    w.textAt(f.title, w.y, { style: "bold", w: CW - 60 });
    w.textAt(String(f.qty), w.y, { x: M + CW - 50, w: 46, align: "right" });
    w.textAt(f.rule, w.y + 11, { size: 7.5, gray: GREY, w: CW - 60 });
    w.y += h + 2;
  }
  w.ensure(16);
  w.rule(w.y);
  w.y += 3;
  w.textAt("Wood screws, about", w.y, { style: "bold" });
  w.textAt(String(c.build.fastenerTotal), w.y, { x: M + CW - 50, w: 46, align: "right", style: "bold" });
  w.y += 20;

  w.ensure(40);
  w.y += w.h3("Assembly order");
  for (const s of c.build.steps) {
    const title = `${s.n}. ${s.title}${s.screws > 0 ? ` · ${s.screws} screws` : ""}`;
    const pieces = s.pieces.map((p) => `${p.qty} × ${p.piece.toLowerCase()} (${p.stock}, ${p.cut})`).join("; ");
    w.ensure(12 + w.height(s.text, { x: M + 12, w: CW - 12 }));
    w.y += w.textAt(title, w.y, { style: "bold" }) + 1;
    w.para(s.text, { x: M + 12, w: CW - 12 }, 1);
    if (pieces) w.para(pieces, { x: M + 12, w: CW - 12, size: 7.5, gray: GREY }, 2);
    w.y += 4;
  }
}

/** The dock label: one page, a heavy border, big type. */
function shippingLabel(w: Writer, l: PrintableLabel) {
  const { pdf } = w;
  w.sheet(null);
  const x = M;
  const y = M;
  const inner = CW - 36;
  const ix = x + 18;
  pdf.setDrawColor(0);
  pdf.setLineWidth(3);
  pdf.rect(x, y, CW, PAGE_H - 2 * M - FOOT, "S");

  let cy = y + 20;
  w.textAt("PART NUMBER", cy, { x: ix, size: 8, style: "bold", gray: GREY });
  cy += 12;
  cy += w.textAt(l.partId, cy, { x: ix, w: inner - 130, size: 40, style: "bold" });
  cy += w.textAt(l.partName, cy, { x: ix, w: inner - 130, size: 16 }) + 12;
  upArrows(w, x + CW - 18 - 100, y + 18, 100);
  cy = Math.max(cy, y + 18 + 108);

  if (l.crate) {
    pdf.setFillColor(0, 0, 0);
    pdf.rect(ix, cy, inner, 30, "F");
    w.font(15, "bold", 255);
    pdf.text(pdfSafe(l.crate), ix + 10, cy + 8, { baseline: "top" });
    cy += 42;
  }

  const colW = inner / 3;
  const cell = (i: number, eyebrow: string, big: string, size: number, small?: string) => {
    const cx = ix + i * colW;
    w.textAt(eyebrow.toUpperCase(), cy, { x: cx, w: colW - 10, size: 8, style: "bold", gray: GREY });
    const h = w.textAt(big, cy + 12, { x: cx, w: colW - 10, size, style: "bold" });
    if (small) w.textAt(small, cy + 14 + h, { x: cx, w: colW - 10, size: 10, gray: GREY });
  };
  cell(0, "Quantity", l.quantity, 28);
  cell(1, "Gross weight", l.gross, 28, l.grossOther);
  cell(2, "Outside L × W × H", l.outside, 14);
  cy += 84;
  pdf.setLineWidth(1.5);
  pdf.line(ix, cy, ix + inner, cy);
  cy += 16;
  cy += w.textAt("THIS SIDE UP", cy, { x: ix, w: inner, size: 34, style: "bold", align: "center" }) + 14;

  const bottomY = y + PAGE_H - 2 * M - FOOT - 60;
  endMarks(w, l, ix + 20, cy, inner - 40, bottomY - cy);
  w.textAt(l.forkEntry.toUpperCase(), bottomY + 18, { x: ix, w: inner, size: 15, style: "bold", align: "center" });
}

/** The ISO 780 "this way up" mark in an 80 × 84 box, scaled to `size` wide. */
function upArrows(w: Writer, x: number, y: number, size: number) {
  const { pdf } = w;
  const s = size / 80;
  pdf.setFillColor(0, 0, 0);
  for (const ax of [24, 56]) {
    pdf.triangle(x + ax * s, y + 8 * s, x + (ax + 14) * s, y + 30 * s, x + (ax - 14) * s, y + 30 * s, "F");
    pdf.rect(x + (ax - 6) * s, y + 30 * s - 0.2, 12 * s, 40 * s, "F");
  }
  pdf.rect(x + 6 * s, y + 74 * s, 68 * s, 6 * s, "F");
}

/** The crate's end: skids, fork arrows between them, and the centre of gravity. */
function endMarks(w: Writer, l: PrintableLabel, x0: number, y0: number, boxW: number, boxH: number) {
  const { pdf } = w;
  const s = Math.min(boxW / l.widthMm, (boxH - 50) / l.heightMm);
  const W = l.widthMm * s;
  const H = l.heightMm * s;
  const skidH = l.skidTallMm * s;
  const x = x0 + (boxW - W) / 2;
  const y = y0;
  pdf.setDrawColor(0);
  pdf.setLineWidth(2);
  pdf.rect(x, y, W, H - skidH, "S");
  pdf.setFillColor(0, 0, 0);
  for (const k of l.skids) pdf.rect(x + k.y * s, y + H - skidH, k.w * s, skidH, "F");
  // The openings the handling checks measured, so the arrows match them.
  const gaps = l.openings.map((o) => ({ from: o.y * s, to: (o.y + o.w) * s })).filter((g) => g.to - g.from > 4);
  for (const g of gaps) {
    const cx = x + (g.from + g.to) / 2;
    pdf.setFillColor(0, 0, 0);
    pdf.triangle(cx, y + H - skidH / 2, cx - 10, y + H + 6, cx + 10, y + H + 6, "F");
    pdf.rect(cx - 4, y + H + 6 - 0.2, 8, 20, "F");
    w.textAt("FORKS", y + H + 30, { x: cx - 40, w: 80, size: 11, style: "bold", align: "center" });
  }
  const cx = x + l.cogEnd.y * s;
  const cy = y + H - l.cogEnd.z * s;
  const r = 12;
  const K = 0.5523 * r;
  pdf.setFillColor(255, 255, 255);
  pdf.setLineWidth(1.5);
  pdf.circle(cx, cy, r, "FD");
  pdf.setFillColor(0, 0, 0);
  pdf.lines(
    [
      [0, -r],
      [K, 0, r, r - K, r, r],
    ],
    cx,
    cy,
    [1, 1],
    "F",
    true,
  );
  pdf.lines(
    [
      [0, r],
      [-K, 0, -r, -(r - K), -r, -r],
    ],
    cx,
    cy,
    [1, 1],
    "F",
    true,
  );
  w.textAt("CENTRE OF GRAVITY", cy - 5, { x: cx + r + 6, w: 140, size: 10 });
}

/** The whole document as PDF bytes (starting `%PDF-`). Pure apart from jsPDF itself. */
export function printableToPdf(doc: PrintableDesign): Uint8Array {
  const w = new Writer(doc);
  w.sheet("Crate spec · PM and logistics");
  if (doc.problem) {
    w.para(doc.problem, { size: 11 });
    return w.finish();
  }
  twoCols(
    w,
    { title: "Part", rows: doc.part },
    doc.shipment.split
      ? { title: "Shipment", lead: [doc.shipment.text ?? ""], rows: doc.shipment.rows, extra: doc.shipment.unmet ? [doc.shipment.unmet] : [] }
      : null,
  );
  if (doc.quantity) quantitySpec(w, doc.quantity);
  for (const c of doc.crates) crateSpec(w, c, doc.shipment.split);
  for (const c of doc.crates) buildSheet(w, doc, c);
  for (const c of doc.crates) shippingLabel(w, c.label);
  return w.finish();
}
