import type { Construction } from "./construction";
import type { Layout } from "./packing";
import type { AddMember, Tag } from "./members";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";
import { addSplicePanel, type PanelFace } from "./splice";
import { frameCount } from "./structure";

/**
 * The crate's shell as boards: floor, joists and skids; the four walls; the lid. Everything
 * the carpenter builds before the dunnage goes in. Sizes come from the `Construction` the
 * structural sizing settled on; this module only lays them out.
 */

/** `count` evenly spaced start positions for boards of `width` across [start, start + span]. */
function spread(start: number, span: number, width: number, count: number): number[] {
  if (count <= 1) return [start];
  const step = (span - width) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

/** Which panels were bigger than a sheet (spec §7.5c): how each was cut, and those that could not be. */
export interface SpliceReport {
  /** Panels cut in pieces: the name as the check says it, the panel's two sides, pieces and seams. */
  spliced: { name: string; sizeMm: [number, number]; pieces: number; seams: number }[];
  /** Panels bigger than a sheet that the sheet is too small to splice; they stay whole. */
  unsplit: { name: string; sizeMm: [number, number] }[];
  /** Seams in all. */
  seams: number;
}

/** The centres and widths of boards laid out by `spread`. */
const centres = (starts: number[], width: number) => starts.map((x) => ({ center: x + width / 2, width }));
const spans = (starts: number[], width: number) => starts.map((x) => [x, x + width] as const);

/** Adds the base, walls and lid of a crate with this interior and construction; says which panels it had to splice. */
export function addShell(interior: Layout["interior"], c: Construction, add: AddMember, standards: ShopStandards = DEFAULT_STANDARDS): SpliceReport {
  const report: SpliceReport = { spliced: [], unsplit: [], seams: 0 };
  const sheet = standards.stock.sheetMm;
  const panel = (name: string, face: PanelFace) => {
    const r = addSplicePanel(face, sheet, c.cleat, add);
    const sizeMm: [number, number] = [face.size[face.axes[0]], face.size[face.axes[1]]];
    if (!r.ok) report.unsplit.push({ name, sizeMm });
    else if (r.seams > 0) report.spliced.push({ name, sizeMm, pieces: r.pieces, seams: r.seams });
    report.seams += r.seams;
  };
  const { panelMm: t, floorMm, cleat, skid, skidCount, joist, baseMm } = c;
  const { thick: ct, wide: cw } = cleat;
  const [L, W, H] = interior;
  const extL = L + 2 * (t + ct);
  const extW = W + 2 * (t + ct);
  const x0 = -t - ct;
  const y0 = -t - ct;
  const verticalCount = (span: number) => frameCount(span, standards);

  // Base: floor sheet over the full footprint, floor joists across the skids, skids underneath.
  const baseTag = (label: string): Tag => ({ assembly: "base", face: "base", label });
  const joistXs = joist ? spread(x0, extL, joist.wide, joist.count) : [];
  const skidYs = spread(y0, extW, skid.wide, skidCount);
  // Under the floor sit the joists when there are any (the skids are below them), else the skids.
  // A seam across the crate wants a joist behind it, a seam along it a skid; the others are cleat stock between them.
  panel("Floor", {
    kind: "floor",
    tag: baseTag("Floor"),
    min: [x0, y0, -floorMm],
    size: [extL, extW, floorMm],
    axes: [0, 1],
    normal: 2,
    cleatMin: -floorMm - ct,
    cleatKind: "cleat",
    backers: joist ? [centres(joistXs, joist.wide), []] : [[], centres(skidYs, skid.wide)],
    run: [
      [y0, y0 + extW],
      [x0, x0 + extL],
    ],
    blocked: joist ? [[], spans(joistXs, joist.wide)] : [spans(skidYs, skid.wide), []],
  });
  if (joist) {
    joistXs.forEach((x) => add("joist", "lumber", baseTag("Floor joist"), [x, y0, -floorMm - joist.tall], [joist.wide, extW, joist.tall]));
  }
  skidYs.forEach((y) => add("skid", "lumber", baseTag("Skid"), [x0, y, -baseMm], [extL, skid.wide, skid.tall]));

  // Long side walls (−Y and +Y). Panels run the full outside length of the end walls.
  for (const side of [-1, 1] as const) {
    const panelY = side < 0 ? -t : W;
    const cleatY = side < 0 ? -t - ct : W + t;
    const tag = (label: string): Tag => ({ assembly: "sides", face: side < 0 ? "side-" : "side+", label });
    const uprightXs = spread(-t, L + 2 * t, cw, verticalCount(L + 2 * t));
    panel("Side panel", {
      kind: "side",
      tag: tag("Side panel"),
      min: [-t, panelY, 0],
      size: [L + 2 * t, t, H],
      axes: [0, 2],
      normal: 1,
      cleatMin: cleatY,
      cleatKind: "cleat",
      backers: [centres(uprightXs, cw), []],
      run: [
        [cw, H - cw],
        [-t, L + t],
      ],
      blocked: [[], spans(uprightXs, cw)],
    });
    // Perimeter frame + intermediate verticals.
    add("cleat", "lumber", tag("Side rail"), [-t, cleatY, 0], [L + 2 * t, ct, cw]);
    add("cleat", "lumber", tag("Side rail"), [-t, cleatY, H - cw], [L + 2 * t, ct, cw]);
    uprightXs.forEach((x) => add("cleat", "lumber", tag("Side upright"), [x, cleatY, cw], [cw, ct, H - 2 * cw]));
  }

  // End walls (−X and +X). Their cleats wrap the corners over the side cleats.
  for (const side of [-1, 1] as const) {
    const panelX = side < 0 ? -t : L;
    const cleatX = side < 0 ? -t - ct : L + t;
    const tag = (label: string): Tag => ({ assembly: "ends", face: side < 0 ? "end-" : "end+", label });
    const uprightYs = spread(y0, extW, cw, verticalCount(extW));
    panel("End panel", {
      kind: "end",
      tag: tag("End panel"),
      min: [panelX, 0, 0],
      size: [t, W, H],
      axes: [1, 2],
      normal: 0,
      cleatMin: cleatX,
      cleatKind: "cleat",
      backers: [centres(uprightYs, cw), []],
      run: [
        [cw, H - cw],
        [0, W],
      ],
      blocked: [[], spans(uprightYs, cw)],
    });
    add("cleat", "lumber", tag("End rail"), [cleatX, y0, 0], [ct, extW, cw]);
    add("cleat", "lumber", tag("End rail"), [cleatX, y0, H - cw], [ct, extW, cw]);
    uprightYs.forEach((y) => add("cleat", "lumber", tag("End upright"), [cleatX, y, cw], [ct, cw, H - 2 * cw]));
  }

  // Lid: panel plus a cleat frame on top, screwed down (removable for unpacking). When crates
  // may be stacked the frame is sized for the load, possibly as joists on edge.
  const lidTag = (label: string): Tag => ({ assembly: "lid", face: "lid", label });
  const { wide: lw, tall: lt, count: lidCount, joists: lidJoists } = c.lid;
  const [edgeLabel, crossLabel] = lidJoists ? ["Lid edge joist", "Lid joist"] : ["Lid edge cleat", "Lid cross cleat"];
  const lidXs = spread(-t, L + 2 * t, lw, lidCount);
  panel("Lid", {
    kind: "lid",
    tag: lidTag("Lid panel"),
    min: [-t, -t, H],
    size: [L + 2 * t, W + 2 * t, t],
    axes: [0, 1],
    normal: 2,
    cleatMin: H + t,
    cleatKind: "lid-cleat",
    backers: [centres(lidXs, lw), []],
    run: [
      [-t + lw, W + t - lw],
      [-t, L + t],
    ],
    blocked: [[], spans(lidXs, lw)],
  });
  add("lid-cleat", "lumber", lidTag(edgeLabel), [-t, -t, H + t], [L + 2 * t, lw, lt]);
  add("lid-cleat", "lumber", lidTag(edgeLabel), [-t, W + t - lw, H + t], [L + 2 * t, lw, lt]);
  lidXs.forEach((x) => add("lid-cleat", "lumber", lidTag(crossLabel), [x, -t + lw, H + t], [lw, W + 2 * t - 2 * lw, lt]));
  return report;
}
