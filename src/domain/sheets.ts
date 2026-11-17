import type { Member } from "./members";
import type { Vec3 } from "./schema";
import type { ShopStandards } from "./standards";
import { MM2_PER_M2 } from "./units";

/**
 * Plywood sheets (spec §7.5c): which panels are bigger than a sheet and how they are split, and
 * how many sheets a crate takes. Pure 2D planning; `splice.ts` turns a plan into boards.
 */

/** Plywood sheet size, mm. Either side can run along a panel: a sheet can be turned. */
export interface Sheet {
  width: number;
  length: number;
}

/**
 * Waste allowance on the plywood area when counting sheets (spec §7.5c). There is no nesting
 * optimiser: real cutting loses wood to saw kerf, offcuts too small to reuse and panels that
 * can't share a sheet, and 15% is the usual shop allowance for a mix of large rectangles.
 */
export const SHEET_WASTE_ALLOWANCE = 0.15;

/**
 * A board narrower than this can't back a seam on its own, so a seam is not moved onto it: a 2×
 * on edge (38 mm) gives each panel 19 mm of bearing at a centred joint, a 1× cleat 44 mm and more.
 */
const MIN_BACKING_MM = 38;

/** A seam is kept this many cleat widths from a panel's edge, clear of the rails and edge cleats. */
const EDGE_CLEATS = 1.5;
/** A seam may move to a backing board at most this share of a piece's width from the even split. */
const SEAM_REACH = 0.25;
/** Most pieces on one side of a panel; beyond it the sheet is taken as too small to splice. */
const MAX_PIECES = 40;
const EPS = 0.01;

/** True when a panel of these sides can be cut from one sheet, turned either way. */
export function fitsSheet(a: number, b: number, sheet: Sheet): boolean {
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  return lo <= Math.min(sheet.width, sheet.length) + EPS && hi <= Math.max(sheet.width, sheet.length) + EPS;
}

/** A board behind the panel running parallel to a seam, as its centre and width along the axis across the seam. */
export interface Backer {
  center: number;
  width: number;
}

interface Seam {
  /** Distance from the panel's start along the axis it divides, mm. */
  at: number;
  /** True when the seam sits on a backing board, so it needs no cleat of its own. */
  backed: boolean;
}

export interface PanelSplit {
  /** Seams across the first and across the second panel axis. Both empty: the panel fits a sheet. */
  cuts: [Seam[], Seam[]];
}

const piecesFor = (span: number, limit: number) => (span <= limit + EPS ? 1 : Math.ceil((span - EPS) / limit));

/**
 * Seam positions along one axis of `span` mm cut into `n` pieces of at most `limit`. Each seam
 * starts at the even split; if a backing board lies within reach of that (and keeps every piece
 * within a sheet) the seam moves onto its centre. Null when the pieces can't be made to fit.
 */
function seamsAlong(span: number, n: number, limit: number, cleatWide: number, backers: readonly Backer[]): Seam[] | null {
  const seams: Seam[] = [];
  const edge = EDGE_CLEATS * cleatWide;
  let prev = 0;
  for (let k = 1; k < n; k++) {
    const ideal = (span * k) / n;
    const lo = Math.max(span - (n - k) * limit, prev + cleatWide, edge);
    const hi = Math.min(prev + limit, span - edge);
    if (lo > hi + EPS) return null;
    const reach = SEAM_REACH * (span / n);
    const near = backers
      .filter((b) => b.width >= MIN_BACKING_MM && b.center >= lo && b.center <= hi && Math.abs(b.center - ideal) <= reach)
      .sort((p, q) => Math.abs(p.center - ideal) - Math.abs(q.center - ideal) || p.center - q.center)[0];
    const at = near ? near.center : Math.min(hi, Math.max(lo, ideal));
    seams.push({ at, backed: !!near });
    prev = at;
  }
  return seams;
}

/**
 * How to split a panel of `size` (its two in-plane sides) into pieces that each fit `sheet`:
 * the sheet is laid whichever way gives fewest pieces, then the shorter total seam. `backers`
 * are the boards already behind the panel, per axis, as `Backer`s in the panel's own coordinates
 * (from its start). Null when the sheet is too small to splice (a piece must be at least two
 * cleats wide, so the cleat behind a seam has wood to screw into on both sides).
 */
export function planSplit(
  size: readonly [number, number],
  sheet: Sheet,
  cleatWide: number,
  backers: readonly [readonly Backer[], readonly Backer[]],
): PanelSplit | null {
  if (fitsSheet(size[0], size[1], sheet)) return { cuts: [[], []] };
  const [short, long] = [Math.min(sheet.width, sheet.length), Math.max(sheet.width, sheet.length)];
  const options = [
    [long, short],
    [short, long],
  ].map(([lu, lv]) => {
    const [nu, nv] = [piecesFor(size[0], lu), piecesFor(size[1], lv)];
    return { lu, lv, nu, nv, pieces: nu * nv, seamMm: (nu - 1) * size[1] + (nv - 1) * size[0] };
  });
  const best = options.reduce((a, b) => (b.pieces < a.pieces || (b.pieces === a.pieces && b.seamMm < a.seamMm - EPS) ? b : a));
  const { lu, lv, nu, nv } = best;
  if (nu > MAX_PIECES || nv > MAX_PIECES) return null;
  if ((nu > 1 && lu < 2 * cleatWide) || (nv > 1 && lv < 2 * cleatWide)) return null;
  const u = seamsAlong(size[0], nu, lu, cleatWide, backers[0]);
  const v = seamsAlong(size[1], nv, lv, cleatWide, backers[1]);
  return u && v ? { cuts: [u, v] } : null;
}

/** The plywood of one thickness a crate takes, and the sheets that is. */
interface SheetLine {
  thicknessMm: number;
  /** Area of the pieces, m². */
  areaM2: number;
  sheets: number;
}

/** What a crate needs in plywood sheets: by thickness, and in all. */
export interface SheetsNeeded {
  sheetMm: Sheet;
  /** Share added to the area before counting (`SHEET_WASTE_ALLOWANCE`). */
  allowance: number;
  lines: SheetLine[];
  total: number;
}

/** Sheets for `areaM2` of pieces: the area plus the allowance, over one sheet's area, rounded up. */
export function sheetCount(areaM2: number, sheet: Sheet, allowance: number): number {
  return areaM2 <= 0 ? 0 : Math.max(1, Math.ceil((areaM2 * (1 + allowance)) / ((sheet.width * sheet.length) / MM2_PER_M2) - 1e-9));
}

/** Builds the sheet count from plywood areas by thickness (lines are sorted thinnest first). */
export function sheetsFromAreas(areas: ReadonlyMap<number, number>, sheet: Sheet, allowance = SHEET_WASTE_ALLOWANCE): SheetsNeeded {
  const lines = [...areas].sort(([a], [b]) => a - b).map(([thicknessMm, areaM2]) => ({ thicknessMm, areaM2, sheets: sheetCount(areaM2, sheet, allowance) }));
  return { sheetMm: { ...sheet }, allowance, lines, total: lines.reduce((n, l) => n + l.sheets, 0) };
}

/**
 * The plywood sheets a crate's boards take (spec §7.5c): each thickness's piece area (every piece
 * by its two largest sides) plus the waste allowance, over the area of one sheet. By area, not a
 * cutting plan, so it is an estimate to buy by, not a guarantee every piece nests.
 */
export function sheetsNeeded(members: readonly Pick<Member, "material" | "size">[], standards: ShopStandards): SheetsNeeded {
  const areas = new Map<number, number>();
  for (const m of members) {
    if (m.material !== "plywood") continue;
    const [longest, middle, thin] = [...m.size].sort((p, q) => q - p) as Vec3;
    const t = Math.round(thin * 10) / 10;
    areas.set(t, (areas.get(t) ?? 0) + (longest * middle) / MM2_PER_M2);
  }
  return sheetsFromAreas(areas, standards.stock.sheetMm);
}
