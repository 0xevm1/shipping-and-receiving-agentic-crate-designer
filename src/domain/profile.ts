import { rotationMatrix, type Mat3 } from "./orientations";
import type { Layout } from "./packing";
import type { Vec3 } from "./schema";

/**
 * Shaped blocking (#16, spec §7.5b): blocking that touches the part's real surfaces instead of
 * its bounding box.
 *
 * The browser measures a **part profile** once per model (`src/lib/partProfile.ts`): for each of
 * the 6 faces of the part's bounding box, a grid of depths from that face inward to the first
 * surface of the mesh, in the part's own frame. This module is pure: it rotates the profile into
 * the crate with the layout's orientation, picks where each blocking post goes (over solid
 * material, where it touches the most surface) and adds shaped blocks that reach into recesses.
 * It also scores any set of blocking against the profile (`restraint`), so bounding-box and
 * shaped blocking can be compared with one number.
 *
 * Without a profile nothing here runs and the crate keeps its bounding-box blocking.
 */

/** Faces of the part's bounding box, by outward normal. */
export const FACE_IDS = ["-x", "+x", "-y", "+y", "-z", "+z"] as const;
export type FaceId = (typeof FACE_IDS)[number];

/** In-plane axes of each face normal axis: [u (columns), v (rows)]. X faces: Y, Z. Y faces: X, Z. Z faces: X, Y. */
export const FACE_AXES: Record<0 | 1 | 2, [number, number]> = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };

/** Depths on one face, sampled at cell centres. */
export interface FaceDepth {
  cols: number;
  rows: number;
  /**
   * Row-major (`row * cols + col`): mm from the bounding-box face inward to the first surface of
   * the part, to 0.1 mm. `-1` where the ray meets no material (an opening right through).
   */
  depth: number[];
}

/** The part's outline as seen from each side of its bounding box, in its own frame (mm, Z up). */
export interface PartProfile {
  version: 1;
  /** The bounding-box size the profile was measured on. */
  sizeMm: Vec3;
  /** Nominal grid spacing; each face divides its sides into whole cells close to this. */
  cellMm: number;
  faces: Record<FaceId, FaceDepth>;
}

/** Blocking within this of the surface counts as touching it. */
const CONTACT_TOLERANCE_MM = 2;
/** A recess shallower than this gets no shaped block: the post is close enough (a 1/4″ shim). */
const MIN_SHAPED_BLOCK_DEPTH_MM = 6;
/**
 * A recess deeper than this gets no shaped block: a longer block would be a cantilever reaching
 * into the part (over a low wall into an open top, say), not blocking.
 */
export const MAX_SHAPED_BLOCK_DEPTH_MM = 100;
/** Heights whose recess depths are within this of each other share one shaped block. */
const SHAPED_BAND_TOLERANCE_MM = 10;
/** Shaped blocks shorter than this (in height) are not worth cutting and are left out. */
const MIN_SHAPED_BLOCK_HEIGHT_MM = 19;
/** A profile measured on a model this far (per axis) from the part's size is not used. */
const PROFILE_SIZE_TOLERANCE_MM = 1;

/**
 * The profile to shape blocking with, or null: none measured, or measured on another size.
 * Layouts that use cradles (`usesCradles`, #6) have no blocking posts, so `designCrate` doesn't ask.
 */
export function usableProfile(part: { dimensions_mm: Vec3; profile?: PartProfile | null }): PartProfile | null {
  const p = part.profile;
  if (!p || p.version !== 1) return null;
  if (!p.sizeMm.every((v, i) => Math.abs(v - part.dimensions_mm[i]) <= PROFILE_SIZE_TOLERANCE_MM)) return null;
  return p;
}

// ---------------------------------------------------------------------------------------------
// Rotating the profile into the crate

/** Rᵀ · v: a crate-frame vector in the part's frame. */
function toPart(m: Mat3, v: Vec3): Vec3 {
  return [0, 1, 2].map((j) => m[0][j] * v[0] + m[1][j] * v[1] + m[2][j] * v[2]) as Vec3;
}

/** A vertical side of a slot in the crate: axis 0 (X) or 1 (Y), and low (−) or high (+). */
export interface Side {
  axis: 0 | 1;
  high: boolean;
}

/**
 * The part's depth map seen from one vertical side of its slot, resampled on a crate-frame grid:
 * columns along the side's horizontal axis, rows up the part's height, both from the slot's min
 * corner. `depth` is NaN where there is no material.
 */
interface SideGrid {
  cols: number;
  rows: number;
  /** Cell size along the side and up. */
  stepH: number;
  stepZ: number;
  depth: Float64Array;
}

/**
 * Results worked out from a profile, per orientation and slot size. Designs are recomputed on
 * every edit and re-ranking designs every layout, but the layouts share a handful of
 * orientations, so each grid and plan is worked out once per profile.
 */
const memo = new WeakMap<PartProfile, Map<string, unknown>>();
function memoized<T>(profile: PartProfile, key: string, make: () => T): T {
  let m = memo.get(profile);
  if (!m) memo.set(profile, (m = new Map()));
  if (!m.has(key)) {
    if (m.size >= 500) m.clear(); // a long session of edits; the next designs refill it
    m.set(key, make());
  }
  return m.get(key) as T;
}
const layoutKey = (layout: Pick<Layout, "orientation" | "cellSize">) => `${layout.orientation.euler.join(",")}|${layout.cellSize.join(",")}`;

/** Samples the profile on one side of a slot laid out with `layout`'s orientation. */
export function sideGrid(profile: PartProfile, layout: Pick<Layout, "orientation" | "cellSize">, side: Side): SideGrid {
  return memoized(profile, `grid|${layoutKey(layout)}|${side.axis}|${side.high}`, () => makeSideGrid(profile, layout, side));
}

function makeSideGrid(profile: PartProfile, layout: Pick<Layout, "orientation" | "cellSize">, side: Side): SideGrid {
  const m = rotationMatrix(layout.orientation);
  const C = layout.cellSize;
  const h = 1 - side.axis;
  // Outward normal in the crate, then in the part: which face of the part looks out this side.
  const normal: Vec3 = [0, 0, 0];
  normal[side.axis] = side.high ? 1 : -1;
  const np = toPart(m, normal);
  const kp = np.findIndex((v) => v !== 0) as 0 | 1 | 2;
  const face = profile.faces[`${np[kp] > 0 ? "+" : "-"}${"xyz"[kp]}` as FaceId];
  const [ua, va] = FACE_AXES[kp];
  const S = profile.sizeMm;

  const cols = Math.max(1, Math.round(C[h] / profile.cellMm));
  const rows = Math.max(1, Math.round(C[2] / profile.cellMm));
  const depth = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Cell centre, as a fraction of the slot from its centre (−0.5 … 0.5).
      const p: Vec3 = [0, 0, 0];
      p[side.axis] = side.high ? 0.5 : -0.5;
      p[h] = (c + 0.5) / cols - 0.5;
      p[2] = (r + 0.5) / rows - 0.5;
      const q = toPart(m, p);
      const at = (axis: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((q[axis] + 0.5) * n)));
      const d = face.depth[at(va, face.rows) * face.cols + at(ua, face.cols)];
      depth[r * cols + c] = d < 0 ? NaN : (d * C[side.axis]) / S[kp];
    }
  }
  return { cols, rows, stepH: C[h] / cols, stepZ: C[2] / rows, depth };
}

// ---------------------------------------------------------------------------------------------
// Placing posts and shaped blocks

/** A shaped block on one part face: heights from the part's bottom, and how far it reaches in. */
interface Band {
  z0: number;
  z1: number;
  depth: number;
}

/**
 * Where one blocking post goes along its side (`offset` from the slot's min corner) and the
 * shaped blocks it carries: `fillLow` on the face of the part on its low side (that part's +
 * face), `fillHigh` on the part on its high side (that part's − face).
 */
interface PostPlan {
  offset: number;
  fillLow: Band[];
  fillHigh: Band[];
}

/** Post plans per horizontal axis: at the low wall, at the high wall, and between two parts. */
interface ShapedBlocking {
  axes: [AxisPlans, AxisPlans];
}
interface AxisPlans {
  wallLow: PostPlan;
  wallHigh: PostPlan;
  between: PostPlan;
}

/** The post plan for each side of the slot at grid index `index` (−X, +X, −Y, +Y). */
export function slotPlans(shaped: ShapedBlocking, index: [number, number, number], counts: [number, number, number]) {
  const pick = (axis: 0 | 1) => {
    const p = shaped.axes[axis];
    return { low: index[axis] === 0 ? p.wallLow : p.between, high: index[axis] === counts[axis] - 1 ? p.wallHigh : p.between };
  };
  return { x: pick(0), y: pick(1) };
}

/** Slot-local box, for keeping shaped blocks on different sides apart. */
interface LocalBox {
  min: Vec3;
  max: Vec3;
}

/**
 * Plans shaped blocking for every slot of `layout`. The slots share one orientation, so every
 * plan is worked out once. `blockWidth` is the post width (`stock.blockWidthMm`).
 */
export function planShapedBlocking(profile: PartProfile, layout: Pick<Layout, "orientation" | "cellSize">, blockWidth: number): ShapedBlocking {
  return memoized(profile, `plan|${layoutKey(layout)}|${blockWidth}`, () => makePlan(profile, layout, blockWidth));
}

function makePlan(profile: PartProfile, layout: Pick<Layout, "orientation" | "cellSize">, blockWidth: number): ShapedBlocking {
  const C = layout.cellSize;
  const grids = ([0, 1] as const).map((axis) => ({
    low: sideGrid(profile, layout, { axis, high: false }),
    high: sideGrid(profile, layout, { axis, high: true }),
  }));
  const taken: LocalBox[] = [];
  const axes = ([0, 1] as const).map((axis) => {
    const h = 1 - axis;
    const w = Math.min(blockWidth, C[h]);
    const { low, high } = grids[axis];
    // A post at the low wall touches the part's − face (on its high side), and so on.
    const plan = (lowFace: SideGrid | null, highFace: SideGrid | null): PostPlan =>
      choosePost(lowFace, highFace, C, axis, w, taken);
    const plans: AxisPlans = { wallLow: plan(null, low), wallHigh: plan(high, null), between: plan(high, low) };
    // X plans go first; Y plans must keep clear of their shaped blocks near the corners.
    for (const p of [plans.wallLow, plans.wallHigh, plans.between]) taken.push(...boxes(p, C, axis, w));
    return plans;
  });
  return { axes: [axes[0], axes[1]] };
}

/** Slot-local boxes of a plan's shaped blocks. */
function boxes(p: PostPlan, C: Vec3, axis: 0 | 1, w: number): LocalBox[] {
  const h = 1 - axis;
  const box = (b: Band, fromHigh: boolean): LocalBox => {
    const min: Vec3 = [0, 0, b.z0];
    const max: Vec3 = [0, 0, b.z1];
    min[axis] = fromHigh ? C[axis] - b.depth : 0;
    max[axis] = fromHigh ? C[axis] : b.depth;
    min[h] = p.offset;
    max[h] = p.offset + w;
    return { min, max };
  };
  // fillLow sits on the + face of the part below the post (inside it from its high side).
  return [...p.fillLow.map((b) => box(b, true)), ...p.fillHigh.map((b) => box(b, false))];
}

function overlaps(a: LocalBox, b: LocalBox): boolean {
  const e = 0.01;
  return [0, 1, 2].every((i) => a.min[i] < b.max[i] - e && b.min[i] < a.max[i] - e);
}

/**
 * The best spot along the side for a post of width `w` touching `lowFace` (the + face of the part
 * on the post's low side) and/or `highFace`: the one where the post and its shaped blocks touch
 * the most surface, nearest the centre on a tie (so a box-shaped part keeps the centred post).
 */
function choosePost(lowFace: SideGrid | null, highFace: SideGrid | null, C: Vec3, axis: 0 | 1, w: number, taken: LocalBox[]): PostPlan {
  const h = 1 - axis;
  const span = C[h] - w;
  const centre = span / 2;
  const grid = (lowFace ?? highFace)!;
  const offsets = new Set<number>([centre]);
  for (let o = 0; o <= span + 1e-9; o += grid.stepH) offsets.add(o);

  let best: { plan: PostPlan; score: number } | null = null;
  for (const offset of offsets) {
    const fillLow = lowFace ? bands(lowFace, offset, w) : [];
    const fillHigh = highFace ? bands(highFace, offset, w) : [];
    const plan = { offset, fillLow, fillHigh };
    if (taken.length && boxes(plan, C, axis, w).some((b) => taken.some((t) => overlaps(b, t)))) continue;
    const [lo, hi] = [lowFace ? contactCells(lowFace, offset, w, fillLow) : [0, 0], highFace ? contactCells(highFace, offset, w, fillHigh) : [0, 0]];
    // A share, not a count: how many grid columns a post covers depends on where it falls on the grid.
    const score = lo[1] + hi[1] ? (lo[0] + hi[0]) / (lo[1] + hi[1]) : 0;
    const better = !best || score > best.score + 1e-9;
    const tie = best && Math.abs(score - best.score) <= 1e-9 && Math.abs(offset - centre) < Math.abs(best.plan.offset - centre);
    if (better || tie) {
      best = { plan, score };
    }
  }
  return best?.plan ?? { offset: centre, fillLow: [], fillHigh: [] };
}

/** Columns of the grid whose cells overlap [offset, offset + w]. */
function overlapCols(g: SideGrid, offset: number, w: number): [number, number] {
  const c0 = Math.max(0, Math.floor(offset / g.stepH + 1e-9));
  const c1 = Math.min(g.cols - 1, Math.ceil((offset + w) / g.stepH - 1e-9) - 1);
  return [c0, c1];
}

/** Columns whose centres lie within [offset, offset + w]: the cells the post's face covers. */
function coveredCols(g: SideGrid, offset: number, w: number): [number, number] {
  const c0 = Math.max(0, Math.ceil((offset - 1e-9) / g.stepH - 0.5));
  const c1 = Math.min(g.cols - 1, Math.floor((offset + w + 1e-9) / g.stepH - 0.5));
  return [c0, c1];
}

/**
 * The shaped blocks a post at `offset` carries on one face: each run of heights where the surface
 * is set back by a similar depth (within `SHAPED_BAND_TOLERANCE_MM`) gets one block reaching to
 * the shallowest point of that run, so it never cuts into the part. Where a run meets a shallower
 * row, it stops at the last sampled height, since the step lies somewhere between samples. Runs
 * outside `MIN_SHAPED_BLOCK_DEPTH_MM`…`MAX_SHAPED_BLOCK_DEPTH_MM` deep, or under
 * `MIN_SHAPED_BLOCK_HEIGHT_MM` tall, get no block.
 */
function bands(g: SideGrid, offset: number, w: number): Band[] {
  const [c0, c1] = overlapCols(g, offset, w);
  const rowDepth: number[] = [];
  for (let r = 0; r < g.rows; r++) {
    let d = Infinity;
    for (let c = c0; c <= c1; c++) {
      const v = g.depth[r * g.cols + c];
      if (!Number.isNaN(v) && v < d) d = v;
    }
    rowDepth.push(d);
  }
  const out: Band[] = [];
  let r = 0;
  while (r < g.rows) {
    const d = rowDepth[r];
    if (!Number.isFinite(d)) {
      r++;
      continue;
    }
    let lo = d;
    let hi = d;
    let end = r;
    while (end + 1 < g.rows && Number.isFinite(rowDepth[end + 1])) {
      const next = rowDepth[end + 1];
      if (Math.max(hi, next) - Math.min(lo, next) > SHAPED_BAND_TOLERANCE_MM) break;
      lo = Math.min(lo, next);
      hi = Math.max(hi, next);
      end++;
    }
    const shallowerBelow = r > 0 && rowDepth[r - 1] < lo;
    const shallowerAbove = end + 1 < g.rows && rowDepth[end + 1] < lo;
    const z0 = (r + (shallowerBelow ? 0.5 : 0)) * g.stepZ;
    const z1 = (end + 1 - (shallowerAbove ? 0.5 : 0)) * g.stepZ;
    if (lo >= MIN_SHAPED_BLOCK_DEPTH_MM && lo <= MAX_SHAPED_BLOCK_DEPTH_MM && z1 - z0 >= MIN_SHAPED_BLOCK_HEIGHT_MM) {
      out.push({ z0: round1(z0), z1: round1(z1), depth: round1(Math.floor(lo * 10) / 10) });
    }
    r = end + 1;
  }
  return out;
}

/** [touching, covered]: cells under the post's face, and those that touch the surface with `fill` reaching in at its heights. */
function contactCells(g: SideGrid, offset: number, w: number, fill: Band[]): [number, number] {
  const [c0, c1] = coveredCols(g, offset, w);
  let n = 0;
  for (let r = 0; r < g.rows; r++) {
    const z = (r + 0.5) * g.stepZ;
    const reach = fill.find((b) => z >= b.z0 && z <= b.z1)?.depth ?? 0;
    for (let c = c0; c <= c1; c++) {
      const v = g.depth[r * g.cols + c];
      if (!Number.isNaN(v) && v - reach <= CONTACT_TOLERANCE_MM) n++;
    }
  }
  return [n, Math.max(0, c1 - c0 + 1) * g.rows];
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------------------------
// Measuring restraint

/** A blocking piece, as a box in crate coordinates, and the axis it blocks along (0 = X, 1 = Y). */
export interface BlockBox {
  min: Vec3;
  size: Vec3;
  axis: 0 | 1;
}

/**
 * How well a set of blocking holds the parts, measured against the part profile (spec §7.5b).
 * - `contact`: the share of the blocking face beside the parts (over the parts' height) that is
 *   within `CONTACT_TOLERANCE_MM` of a part surface. Blocking over an opening or a recess counts
 *   against it.
 * - `freeMm`: per horizontal axis [X, Y], the furthest any part can slide toward a side before
 *   it meets the blocking there; `Infinity` when nothing on a side stops it.
 */
export interface Restraint {
  contact: number;
  freeMm: [number, number];
}

/** Scores `blocks` against the profile for every slot of `layout`. */
export function restraint(profile: PartProfile, layout: Pick<Layout, "orientation" | "cellSize" | "slots">, blocks: BlockBox[]): Restraint {
  const r = (v: number) => Math.round(v * 10);
  const key = [
    "restraint",
    layoutKey(layout),
    layout.slots.map((s) => s.min.map(r).join(",")).join(";"),
    blocks.map((b) => `${b.axis}:${[...b.min, ...b.size].map(r).join(",")}`).join(";"),
  ].join("|");
  return memoized(profile, key, () => measureRestraint(profile, layout, blocks));
}

function measureRestraint(profile: PartProfile, layout: Pick<Layout, "orientation" | "cellSize" | "slots">, blocks: BlockBox[]): Restraint {
  const C = layout.cellSize;
  let covered = 0;
  let touching = 0;
  const free: [number, number] = [0, 0];
  for (const axis of [0, 1] as const) {
    const h = 1 - axis;
    for (const high of [false, true]) {
      const g = sideGrid(profile, layout, { axis, high });
      for (const slot of layout.slots) {
        const face = slot.min[axis] + (high ? C[axis] : 0);
        // Pieces that reach this face from outside or start at it and reach inward; `reach` is
        // how far past the face their inner side is.
        // Paint each piece's reach onto the cells whose centres its face covers; keep the furthest.
        const reachAt = new Float64Array(g.cols * g.rows).fill(-Infinity);
        for (const b of blocks) {
          const lo = b.min[axis];
          const hi = lo + b.size[axis];
          if (b.axis !== axis || lo > face + 0.01 || hi < face - 0.01) continue;
          const reach = high ? face - lo : hi - face;
          if (reach < -0.01) continue;
          const c0 = Math.max(0, Math.ceil((b.min[h] - slot.min[h]) / g.stepH - 0.5 - 1e-9));
          const c1 = Math.min(g.cols - 1, Math.floor((b.min[h] + b.size[h] - slot.min[h]) / g.stepH - 0.5 + 1e-9));
          const r0 = Math.max(0, Math.ceil((b.min[2] - slot.min[2]) / g.stepZ - 0.5 - 1e-9));
          const r1 = Math.min(g.rows - 1, Math.floor((b.min[2] + b.size[2] - slot.min[2]) / g.stepZ - 0.5 + 1e-9));
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) if (reach > reachAt[r * g.cols + c]) reachAt[r * g.cols + c] = reach;
          }
        }
        let sideFree = Infinity;
        for (let i = 0; i < reachAt.length; i++) {
          const reach = reachAt[i];
          if (reach === -Infinity) continue;
          covered++;
          const v = g.depth[i];
          if (Number.isNaN(v)) continue;
          const gap = Math.max(0, v - reach);
          if (gap <= CONTACT_TOLERANCE_MM) touching++;
          if (gap < sideFree) sideFree = gap;
        }
        if (sideFree > free[axis]) free[axis] = sideFree;
      }
    }
  }
  return { contact: covered ? touching / covered : 0, freeMm: free };
}
