import type { AddMember, MemberKind, Tag } from "./members";
import type { Vec3 } from "./schema";
import { planSplit, type Backer, type Sheet } from "./sheets";

/**
 * Splices a panel bigger than a sheet into boards (spec §7.5c): the pieces, and a joint cleat
 * behind each seam that has no board behind it already. Coordinates are the crate's (mm, Z up).
 */

type Axis = 0 | 1 | 2;
type Interval = readonly [number, number];

/** Cleat pieces shorter than this are dropped: a stub between two boards backs nothing. */
const MIN_CLEAT_MM = 50;

/** A panel and what lies behind it, as the shell knows it. */
export interface PanelFace {
  kind: MemberKind;
  tag: Tag;
  min: Vec3;
  size: Vec3;
  /** The two in-plane axes (u, v) and the normal axis. */
  axes: readonly [Axis, Axis];
  normal: Axis;
  /** Joint cleat: lowest coordinate on the normal axis (its thickness is `cleat.thick`) and its kind. */
  cleatMin: number;
  cleatKind: MemberKind;
  /** Per in-plane axis: boards behind the panel running parallel to a seam across that axis, in crate coordinates. */
  backers: readonly [readonly Backer[], readonly Backer[]];
  /** Per in-plane axis: the extent along the other axis a cleat behind a seam across this one may run. */
  run: readonly [Interval, Interval];
  /** Per in-plane axis: intervals along the other axis that boards crossing such a cleat occupy. */
  blocked: readonly [readonly Interval[], readonly Interval[]];
}

export interface SpliceResult {
  /** Seams across the panel (each a full line, whether or not it needed a cleat of its own). */
  seams: number;
  /** Pieces the panel was cut into. */
  pieces: number;
  /** False when the panel is bigger than a sheet and the sheet is too small to splice. The panel is then left whole. */
  ok: boolean;
}

/** `[lo, hi]` less the `blocked` intervals: the stretches left, each at least `MIN_CLEAT_MM` long. */
function freeStretches(lo: number, hi: number, blocked: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let at = lo;
  for (const [b0, b1] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (b0 > at) out.push([at, Math.min(b0, hi)]);
    at = Math.max(at, b1);
  }
  if (at < hi) out.push([at, hi]);
  return out.filter(([a, b]) => b - a >= MIN_CLEAT_MM);
}

/**
 * Adds the panel, whole when it fits a sheet, else cut into pieces with joint cleats. Pieces
 * keep the panel's tag; cleats are `Panel joint cleat` boards of the cleat stock, centred on the
 * seam, wide face against the panel.
 */
export function addSplicePanel(face: PanelFace, sheet: Sheet, cleat: { thick: number; wide: number }, add: AddMember): SpliceResult {
  const { axes, normal, min, size } = face;
  const [u, v] = axes;
  const local = (backers: readonly Backer[], axis: Axis) => backers.map((b) => ({ ...b, center: b.center - min[axis] }));
  const split = planSplit([size[u], size[v]], sheet, cleat.wide, [local(face.backers[0], u), local(face.backers[1], v)]);
  const whole = () => add(face.kind, "plywood", face.tag, min, size);
  if (!split) {
    whole();
    return { seams: 0, pieces: 1, ok: false };
  }
  const edges = (axis: 0 | 1) => {
    const cuts = [0, ...split.cuts[axis].map((s) => s.at), size[axes[axis]]];
    return cuts.slice(1).map((end, i) => [cuts[i], end] as const);
  };
  const [us, vs] = [edges(0), edges(1)];
  for (const [u0, u1] of us) {
    for (const [v0, v1] of vs) {
      const pMin: Vec3 = [...min];
      const pSize: Vec3 = [...size];
      pMin[u] = min[u] + u0;
      pSize[u] = u1 - u0;
      pMin[v] = min[v] + v0;
      pSize[v] = v1 - v0;
      add(face.kind, "plywood", face.tag, pMin, pSize);
    }
  }

  const tag: Tag = { ...face.tag, label: "Panel joint cleat", variant: "joint-cleat" };
  const half = cleat.wide / 2;
  const placed: Interval[] = []; // footprints of the cleats across u, along u: later cleats across v run between them
  const cleatAcross = (axis: 0 | 1, at: number, stretches: readonly Interval[]) => {
    const [across, along] = axis === 0 ? [u, v] : [v, u];
    for (const [a, b] of stretches) {
      const cMin: Vec3 = [0, 0, 0];
      const cSize: Vec3 = [0, 0, 0];
      cMin[across] = min[across] + at - half;
      cSize[across] = cleat.wide;
      cMin[along] = a;
      cSize[along] = b - a;
      cMin[normal] = face.cleatMin;
      cSize[normal] = cleat.thick;
      add(face.cleatKind, "lumber", tag, cMin, cSize);
    }
  };
  for (const seam of split.cuts[0]) {
    if (seam.backed) continue;
    const x = min[u] + seam.at;
    placed.push([x - half, x + half]);
    cleatAcross(0, seam.at, freeStretches(face.run[0][0], face.run[0][1], face.blocked[0]));
  }
  for (const seam of split.cuts[1]) {
    if (seam.backed) continue;
    cleatAcross(1, seam.at, freeStretches(face.run[1][0], face.run[1][1], [...face.blocked[1], ...placed]));
  }
  return { seams: split.cuts[0].length + split.cuts[1].length, pieces: us.length * vs.length, ok: true };
}
