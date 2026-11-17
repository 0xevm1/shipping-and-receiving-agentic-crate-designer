/**
 * Fork-entry arrows on the ground at both ends of the crate: their size and placement, and when
 * the crate hides one. Pure TypeScript in crate-interior mm (domain frame, Z up).
 */
import type { Vec3 } from "@/domain/schema";
import { labelOffsetMm } from "./sizeLines";

/** Arrow length along X, mm. */
export function arrowLengthMm(external: readonly number[]): number {
  return Math.min(320, Math.max(180, 0.17 * external[0]));
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

/** How far outside the end face the arrow's tail reaches, mm (what the camera framing must fit). */
export function arrowReachMm(external: readonly number[]): number {
  return arrowGapMm(external) + arrowLengthMm(external);
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

/** Points spread over a flat arrow lying on the ground: a 3 × 3 grid over its length and width. */
export function arrowSamples(tip: Vec3, outward: 1 | -1, length: number, width: number): Vec3[] {
  const points: Vec3[] = [];
  for (const along of [0.05, 0.5, 0.95])
    for (const across of [-0.4, 0, 0.4]) points.push([tip[0] + outward * along * length, tip[1] + across * width, tip[2]]);
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
