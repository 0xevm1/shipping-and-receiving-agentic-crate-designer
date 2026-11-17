/**
 * Size-line geometry, in crate-interior mm (domain frame, Z up). Pure TypeScript (no three.js,
 * no React), so it is unit-tested directly and shared by what draws the lines (`DimensionLines`),
 * what labels them (`SizeLabels`) and what frames them (`framing`).
 */
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { length, lengthUnit, type Units } from "@/lib/units";
import type { CameraPreset } from "@/state/store";
import { EXPLODE_WALL_MM } from "./scene";

export type Seg = [Vec3, Vec3];
/** Which group of lines a dimension belongs to: they move out with different walls when exploded. */
export type Where = "front" | "right" | "part";
export type Axis = "length" | "width" | "height";

/** Where a photon pulse starts on one dimension line. */
export interface Anchor {
  at: Vec3;
  value: number;
  where: Where;
  /** Index in `lines[where]` of the dimension line this anchor sits on. */
  seg: number;
}

/** One size pill: the numbers it shows (mm) and where it sits. The part's three sizes share one. */
export interface SizeLabel {
  at: Vec3;
  where: Where;
  values: number[];
  /** Sizes of the part, drawn in sky blue, rather than of the crate. */
  inner: boolean;
}

/** A pill's text: its sizes in the displayed unit, "36.7 in" or "14.2 × 8.7 × 10.2 in". */
export function labelText(label: Pick<SizeLabel, "values">, units: Units): string {
  return `${label.values.map((v) => length(v, units)).join(" × ")} ${lengthUnit(units)}`;
}

/** A pill on screen: its centre and size, px. */
export interface PillBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const apart = (a: PillBox, b: PillBox, gap: number) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;

/**
 * Moves pills up or down so no two overlap. `pills` are in priority order: each one steps clear of
 * the ones before it (taking the shorter way, below or above), so the crate's own sizes stay where
 * their lines are and the part's pill gives way. Changes `y` in place.
 */
export function separatePills(pills: PillBox[], gap = 2): void {
  for (let i = 1; i < pills.length; i++) {
    for (let pass = 0; pass < 4; pass++) {
      const hit = pills.slice(0, i).find((o) => apart(pills[i], o, gap));
      if (!hit) break;
      const p = pills[i];
      const below = hit.y + (hit.h + p.h) / 2 + gap;
      const above = hit.y - (hit.h + p.h) / 2 - gap;
      p.y = Math.abs(below - p.y) <= Math.abs(above - p.y) ? below : above;
    }
  }
}

/** How far the dimension lines (and so the width label) stand off the crate: 110 mm plus 5 % of its longest side. */
export function labelOffsetMm(external: readonly number[]): number {
  return 110 + 0.05 * Math.max(...external);
}

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * The dimension whose axis points at the camera in a straight-on preset. Its line collapses to a
 * point or reads as a plan dimension (the height on a top view), so it is left out.
 */
export function hiddenAxis(camera: CameraPreset | null): Axis | null {
  switch (camera) {
    case "top":
      return "height";
    case "front":
      return "width";
    case "end":
      return "length";
    default:
      return null;
  }
}

/**
 * Size lines. Crate: length along the front bottom edge, width along the right bottom edge,
 * height at the back right corner, each with witness lines from the crate corners out past the
 * dimension line to a tick end. Part (`withPart`): three edges of one part (top layer, front row,
 * rightmost). `hide` leaves one crate dimension out (see `hiddenAxis`).
 */
export function buildLines(design: CrateDesign, withPart: boolean, hide: Axis | null = null) {
  const { layout, construction } = design;
  const ext = layout.external;
  const o = construction.panelMm + construction.cleat.thick;
  const mn: Vec3 = [-o, -o, -construction.baseMm];
  const mx: Vec3 = [mn[0] + ext[0], mn[1] + ext[1], mn[2] + ext[2]];
  const longest = Math.max(...ext);
  const off = labelOffsetMm(ext);
  const tick = 40 + longest * 0.0125;
  const z = mn[2];

  const La: Vec3 = [mn[0], mn[1] - off, z];
  const Lb: Vec3 = [mx[0], mn[1] - off, z];
  const Wa: Vec3 = [mx[0] + off, mn[1], z];
  const Wb: Vec3 = [mx[0] + off, mx[1], z];
  const Hb: Vec3 = [mx[0] + off, mx[1], mx[2]];

  const lines: Record<Where, Seg[]> = { front: [], right: [], part: [] };
  const anchors: Anchor[] = [];
  const labels: SizeLabel[] = [];
  /** Adds a dimension: its line first, then its witness lines. */
  const dimension = (where: Where, a: Vec3, b: Vec3, value: number, witness: Seg[]) => {
    const seg = lines[where].push([a, b]) - 1;
    lines[where].push(...witness);
    const at = mid(a, b);
    anchors.push({ at, value, where, seg });
    labels.push({ at, where, values: [value], inner: false });
  };

  if (hide !== "length") {
    dimension("front", La, Lb, ext[0], [
      [
        [mn[0], mn[1], z],
        [mn[0], mn[1] - off - tick, z],
      ],
      [
        [mx[0], mn[1], z],
        [mx[0], mn[1] - off - tick, z],
      ],
    ]);
  }
  if (hide !== "width") {
    dimension("right", Wa, Wb, ext[1], [
      [
        [mx[0], mn[1], z],
        [mx[0] + off + tick, mn[1], z],
      ],
      [
        [mx[0], mx[1], z],
        [mx[0] + off + tick, mx[1], z],
      ],
    ]);
  }
  if (hide !== "height") {
    dimension("right", Wb, Hb, ext[2], [
      [
        [mx[0], mx[1], mx[2]],
        [mx[0] + off + tick, mx[1], mx[2]],
      ],
    ]);
  }

  if (withPart && layout.slots.length) {
    const top = Math.max(...layout.slots.map((s) => s.index[2]));
    const row = layout.slots.filter((s) => s.index[2] === top && s.index[1] === 0);
    const s0 = row.reduce((a, b) => (b.index[0] > a.index[0] ? b : a));
    const c = layout.cellSize;
    const p = s0.min;
    const q: Vec3 = [p[0] + c[0], p[1] + c[1], p[2] + c[2]];
    const edges: [Seg, number][] = [
      [
        [
          [p[0], p[1], q[2]],
          [q[0], p[1], q[2]],
        ],
        c[0],
      ],
      [
        [
          [q[0], p[1], q[2]],
          [q[0], q[1], q[2]],
        ],
        c[1],
      ],
      [
        [
          [q[0], p[1], p[2]],
          [q[0], p[1], q[2]],
        ],
        c[2],
      ],
    ];
    const mids: Vec3[] = [];
    for (const [seg, value] of edges) {
      const at = mid(...seg);
      mids.push(at);
      anchors.push({ at, value, where: "part", seg: lines.part.length });
      lines.part.push(seg);
    }
    // One pill for all three sizes: three pills a few px apart overlapped without leaders.
    const centre = [0, 1, 2].map((i) => (mids[0][i] + mids[1][i] + mids[2][i]) / 3) as Vec3;
    labels.push({ at: centre, where: "part", values: c.slice(0, 3), inner: true });
  }
  return { lines, anchors, labels };
}

/**
 * Anchors of the crate's size labels in crate-interior mm, moved out with the walls by explode
 * amount `e`, as `DimensionLines` draws them. `framing` fits these. The part's label sits inside
 * the crate, so it doesn't need its own room.
 */
export function crateLabelAnchors(design: CrateDesign, e: number): Vec3[] {
  const out = EXPLODE_WALL_MM * e;
  return buildLines(design, false).labels.map(({ at, where }) =>
    where === "front" ? [at[0], at[1] - out, at[2]] : where === "right" ? [at[0] + out, at[1], at[2]] : at,
  );
}
