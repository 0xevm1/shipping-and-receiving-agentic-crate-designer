/**
 * Fork-entry arrows on the ground at the crate's entry faces: both ends (-X, +X) for end entry, both
 * long sides (-Y, +Y) for side entry, all four for four-way entry (#112). Their size and placement,
 * and when the crate hides one. Pure TypeScript in crate-interior mm (domain frame, Z up).
 */
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { labelOffsetMm } from "./sizeLines";

/** Arrow length along the way it points (`axis`: 0 = X for the ends, 1 = Y for the sides), mm. */
export function arrowLengthMm(external: readonly number[], axis: 0 | 1 = 0): number {
  return Math.min(320, Math.max(180, 0.17 * external[axis]));
}

/** One face a fork enters through: the axis the forks travel along and which face of it (-1 the low one). */
export interface ForkEnd {
  axis: 0 | 1;
  outward: 1 | -1;
  /** The entry's openings across that axis: where one arrow goes each. */
  openings: { y: number; width: number }[];
}

/**
 * The faces the forks enter, in the order the scene numbers its ends: for each direction the crate
 * must be enterable from (the ends first, then the sides), its low face then its high one. Two for
 * ends or sides, four for four-way.
 */
export function forkEnds(design: CrateDesign): ForkEnd[] {
  return design.handling.entries.flatMap((e) => {
    const axis = e.direction === "ends" ? 0 : 1;
    return ([-1, 1] as const).map((outward) => ({ axis, outward, openings: e.openings }));
  });
}

/**
 * How far outside the end face the arrow's tip stops, mm. The width size label sits on the same
 * centre line, `labelOffsetMm` beyond the end, and a label is a fixed-size pill over a crate that
 * scales to fit, so it covers about a third of the longest side in mm (a little more when
 * exploded, where the framing zooms out). The tip starts beyond both, so the arrow and the
 * width label never overlap.
 */
export function arrowGapMm(external: readonly number[]): number {
  return labelOffsetMm(external) + 0.36 * Math.max(...external) + 90;
}

/** An arrow's width across, mm: 70 % of the opening it points into, at most 220. */
export const arrowWidthMm = (openingWidthMm: number) => Math.min(openingWidthMm * 0.7, 220);

/** The head's length along the arrow, mm (the rest is shaft). */
export const arrowHeadMm = (length: number, width: number) => Math.min(length * 0.45, width * 1.2);

/** How far outside the end face the arrow's tail reaches, mm (what the camera framing must fit). */
export function arrowReachMm(external: readonly number[], axis: 0 | 1 = 0): number {
  return arrowGapMm(external) + arrowLengthMm(external, axis);
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Whether the segment from `a` to `b` passes through `box` (slab test). */
function segmentHitsBox(a: Vec3, b: Vec3, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-9) {
      if (a[i] < box.min[i] || a[i] > box.max[i]) return false;
      continue;
    }
    let near = (box.min[i] - a[i]) / d;
    let far = (box.max[i] - a[i]) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 > t1) return false;
  }
  return true;
}

/** A point `along` the arrow's way (toward its tail when `outward` is 1) and `across` it, from `tip`, on the arrow's own axis. */
function arrowPoint(tip: Vec3, outward: 1 | -1, axis: 0 | 1, along: number, across: number): Vec3 {
  return axis === 0 ? [tip[0] + outward * along, tip[1] + across, tip[2]] : [tip[0] + across, tip[1] + outward * along, tip[2]];
}

/** Points spread over a flat arrow lying on the ground: a 3 × 3 grid over its length and width. */
export function arrowSamples(tip: Vec3, outward: 1 | -1, length: number, width: number, axis: 0 | 1 = 0): Vec3[] {
  const points: Vec3[] = [];
  for (const along of [0.05, 0.5, 0.95]) for (const across of [-0.4, 0, 0.4]) points.push(arrowPoint(tip, outward, axis, along * length, across * width));
  return points;
}

/** The share (0..1) of `samples` that the crate `box` hides from an eye at `eye`. */
export function occludedShare(eye: Vec3, samples: readonly Vec3[], box: Box): number {
  let hidden = 0;
  for (const p of samples) if (segmentHitsBox(eye, p, box)) hidden++;
  return hidden / samples.length;
}

/** Share of an arrow hidden above which it is dropped, and below which it comes back. */
export const HIDE_ABOVE = 0.6;
export const SHOW_BELOW = 0.4;

/** Hysteresis, so an arrow near the threshold doesn't flicker while the camera turns. */
export function nextHidden(hidden: boolean, share: number): boolean {
  return hidden ? share > SHOW_BELOW : share > HIDE_ABOVE;
}

/* ---- Keeping an arrow in the free area ---------------------------------------------------------- */

/** The part of the canvas, px, that nothing covers: the crate's free area (the store's `insets`). */
export interface FreeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The smallest an arrow is drawn when it is squeezed (a share of its size), and the length it needs to come back after being dropped. */
export const MIN_ARROW_SCALE = 0.5;
export const ARROW_RETURN_SCALE = 0.6;
/** Px an arrow keeps from the edge of the free area; and how far past the crate's free left edge it may reach (the window edge less this). */
export const ARROW_MARGIN_PX = 4;
const ARROW_EDGE_PX = 12;

/**
 * Where a fork arrow may be drawn: the free area the panels leave (so never under the island, the
 * header or the bottom bars), except that it may run out toward the window's left edge, where the
 * crate's own framing keeps a gutter (`left` inset) that an arrow, being low and flat, needn't.
 */
export function arrowFreeRect(insets: { left: number; top: number; right: number; bottom: number }, width: number, height: number): FreeRect {
  return {
    left: Math.min(insets.left, ARROW_EDGE_PX),
    top: insets.top,
    right: width - insets.right,
    bottom: height - insets.bottom,
  };
}

/**
 * The corners of an arrow lying on the ground, tip first, at `scale` of its size: the tip, both
 * head corners and both tail corners (crate-interior mm). Scaling keeps the tip where it is, so the
 * gap to the width label never changes, and the proportions, so a short arrow is a small one.
 */
export function arrowOutline(tip: Vec3, outward: 1 | -1, length: number, width: number, scale = 1, axis: 0 | 1 = 0): Vec3[] {
  const head = arrowHeadMm(length, width) * scale;
  const shaft = width * 0.4 * scale;
  const tail = length * scale;
  width *= scale;
  const at = (along: number, across: number): Vec3 => arrowPoint(tip, outward, axis, along, across);
  return [at(0, 0), at(head, width / 2), at(head, -width / 2), at(tail, shaft / 2), at(tail, -shaft / 2)];
}

/**
 * The size scale at which a fork arrow sits wholly inside the free area as the camera sees it: 1
 * if it already does, otherwise the longest scale down to `MIN_ARROW_SCALE` that does, and 0 when
 * even a short arrow wouldn't (its tip is under the island or off screen), so the arrow is dropped
 * rather than drawn under glass. `dropped` is whether it is dropped now: it then needs
 * `ARROW_RETURN_SCALE` to come back, so an arrow at the edge doesn't flicker as the camera turns.
 * `project` maps crate-interior mm to canvas px.
 */
export function fitArrowScale(
  tip: Vec3,
  outward: 1 | -1,
  length: number,
  width: number,
  project: (p: Vec3) => readonly [number, number],
  free: FreeRect,
  dropped = false,
  axis: 0 | 1 = 0,
): number {
  const inside = (scale: number) =>
    arrowOutline(tip, outward, length, width, scale, axis).every((p) => {
      const [x, y] = project(p);
      return x >= free.left + ARROW_MARGIN_PX && x <= free.right - ARROW_MARGIN_PX && y >= free.top + ARROW_MARGIN_PX && y <= free.bottom - ARROW_MARGIN_PX;
    });
  if (inside(1)) return 1;
  const least = dropped ? ARROW_RETURN_SCALE : MIN_ARROW_SCALE;
  if (!inside(least)) return 0;
  let lo = least;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The nearest an arrow's tip stands to an end face, mm. */
export const ARROW_MIN_GAP_MM = 120;
/** Px kept between an arrow and the width label's pill. */
export const ARROW_LABEL_MARGIN_PX = 6;

/**
 * How far from the end face the arrow's tip stands this frame, mm, at the end with the width label:
 * the smallest gap, down to `ARROW_MIN_GAP_MM`, at which the arrow's outline stays clear of the
 * label's pill on screen (`label`: its anchor and half size in px). The worst case, `maxGap`
 * (`arrowGapMm`), clears the label however the camera sits, but stands so far out that the arrow
 * often lands under the island; clear on screen is enough, and leaves it room inside the free area.
 * `outlineAt` is the arrow at a given gap, `project` maps crate-interior mm to canvas px.
 */
export function clearGapMm(
  outlineAt: (gap: number) => Vec3[],
  project: (p: Vec3) => readonly [number, number],
  label: { at: Vec3; halfPx: { x: number; y: number } },
  maxGap: number,
): number {
  const min = Math.min(ARROW_MIN_GAP_MM, maxGap);
  const [lx, ly] = project(label.at);
  const clear = (gap: number) => {
    const px = outlineAt(gap).map(project);
    const left = Math.min(...px.map((p) => p[0]));
    const right = Math.max(...px.map((p) => p[0]));
    const top = Math.min(...px.map((p) => p[1]));
    const bottom = Math.max(...px.map((p) => p[1]));
    const hx = label.halfPx.x + ARROW_LABEL_MARGIN_PX;
    const hy = label.halfPx.y + ARROW_LABEL_MARGIN_PX;
    return right < lx - hx || left > lx + hx || bottom < ly - hy || top > ly + hy;
  };
  if (clear(min)) return min;
  if (!clear(maxGap)) return maxGap;
  let lo = min;
  let hi = maxGap;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The crate's extent along an axis (0 = X, 1 = Y), mm: its boards' lowest and highest faces (the arrows' tips are measured from them). */
export function crateRange(design: CrateDesign, axis: 0 | 1): [number, number] {
  const lo = Math.min(...design.members.map((m) => m.min[axis]));
  const hi = Math.max(...design.members.map((m) => m.min[axis] + m.size[axis]));
  return [lo, hi];
}

/** One fork arrow as it lies in the scene this frame: its end, size, where its tip stands and how much of its length is drawn. */
export interface ArrowLayout {
  /** Position in `forkEnds` (0 and 1 are the -X and +X ends; 2 and 3 the -Y and +Y sides of a four-way crate). */
  end: number;
  /** The axis the arrow points along: 0 = X (an end), 1 = Y (a side). */
  axis: 0 | 1;
  /** Position among the end's arrows (one per opening). */
  index: number;
  /** -1 for the low face, 1 for the high one: which way the arrow's tail points away from the crate. */
  outward: 1 | -1;
  /** Tip, crate-interior mm, with the walls slid out by `out`. */
  tip: Vec3;
  /** Tip's distance from the end face before the explode, mm. */
  gap: number;
  length: number;
  width: number;
  /** Share of its size drawn: 1, smaller to stay in the free area, or 0 when there is no room for it. */
  scale: number;
}

/**
 * Where each fork arrow stands and how long it is drawn, for the camera that `project` stands for
 * (`out` is `EXPLODE_WALL_MM × explode`). Per end: the tip's gap from the end face (`clearGapMm`;
 * `label` is the width label's anchor at the +X end), then per arrow the length that keeps it in
 * `free` (`fitArrowScale`). `dropped[end][index]` says which are dropped now, for the hysteresis.
 * Pure, so it can be checked for any size and view without a renderer.
 */
export function layoutArrows(
  design: CrateDesign,
  out: number,
  project: (p: Vec3) => readonly [number, number],
  free: FreeRect,
  label: { at: Vec3; halfPx: { x: number; y: number } },
  dropped: readonly (readonly boolean[])[] = [],
): ArrowLayout[] {
  const ext = design.layout.external;
  const maxGap = arrowGapMm(ext);
  const z = design.handling.groundZ + 2;
  const layout: ArrowLayout[] = [];
  forkEnds(design).forEach(({ axis, outward, openings: raw }, end) => {
    const [lo, hi] = crateRange(design, axis);
    const length = arrowLengthMm(ext, axis);
    const openings = raw.map((o) => ({ at: o.y + o.width / 2, width: arrowWidthMm(o.width) }));
    const face = outward < 0 ? lo : hi;
    const tipAt = (gap: number, across: number): Vec3 => (axis === 0 ? [face + outward * (gap + out), across, z] : [across, face + outward * (gap + out), z]);
    // Only the +X end has a size label in the way. The other faces' arrows, near a crate that hides them from the usual angle, keep the full gap.
    const labelled = axis === 0 && outward === 1;
    const gap = labelled
      ? clearGapMm((g) => openings.flatMap((a) => arrowOutline(tipAt(g, a.at), outward, length, a.width, 1, axis)), project, label, maxGap)
      : maxGap;
    openings.forEach((a, index) => {
      const tip = tipAt(gap, a.at);
      layout.push({
        end,
        axis,
        index,
        outward,
        tip,
        gap,
        length,
        width: a.width,
        scale: fitArrowScale(tip, outward, length, a.width, project, free, dropped[end]?.[index] ?? false, axis),
      });
    });
  });
  return layout;
}
