import type { Vec3 } from "./schema";

const Q = Math.PI / 2;

export interface Orientation {
  id: string;
  label: string;
  /** Euler angles (radians, XYZ order) applied to the part in the crate frame. */
  euler: [number, number, number];
  /** True when the part's modeled Z axis stays vertical. */
  upright: boolean;
}

/**
 * The six axis-aligned orientations of a box (one per axis permutation).
 * Mirror images are excluded since they aren't physical rotations.
 */
export const ORIENTATIONS: Orientation[] = [
  { id: "as-modeled", label: "As modeled", euler: [0, 0, 0], upright: true },
  { id: "turned", label: "Turned 90°", euler: [0, 0, Q], upright: true },
  { id: "on-side-x", label: "On its side", euler: [Q, 0, 0], upright: false },
  { id: "on-side-x-turned", label: "On its side, turned 90°", euler: [Q, 0, Q], upright: false },
  { id: "on-end-y", label: "On end", euler: [0, Q, 0], upright: false },
  { id: "on-end-y-turned", label: "On end, turned 90°", euler: [0, Q, Q], upright: false },
];

export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * The orientation as an integer rotation matrix. Euler angles are XYZ, composed as in three.js
 * (R = Rx · Ry · Rz), which is what the viewer applies. Every angle is a multiple of 90°, so
 * each sine and cosine rounds to -1, 0 or 1 and the matrix is exact.
 */
export function rotationMatrix(o: Pick<Orientation, "euler">): Mat3 {
  const [a, b, c] = o.euler;
  const r = (v: number) => Math.round(v);
  const [ca, sa, cb, sb, cc, sc] = [r(Math.cos(a)), r(Math.sin(a)), r(Math.cos(b)), r(Math.sin(b)), r(Math.cos(c)), r(Math.sin(c))];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/**
 * Bounding-box size of a part after rotation. For a box rotated by an axis-aligned matrix, the
 * new extent along each axis is the sum of the old extents weighted by |R|, so the packing
 * result and the 3D view (which rotates by the same Euler angles) can't disagree.
 */
export function rotatedSize(size: Vec3, orientation: Orientation): Vec3 {
  const m = rotationMatrix(orientation);
  const extent = (row: number) => Math.abs(m[row][0]) * size[0] + Math.abs(m[row][1]) * size[1] + Math.abs(m[row][2]) * size[2];
  return [round(extent(0)), round(extent(1)), round(extent(2))];
}

/**
 * A vector fixed to the part (its centre of gravity's offset from the box centre) after the
 * orientation turns the part: R · v, the same rotation the viewer applies and `rotatedSize` follows.
 * The box centre stays the box centre, so the offset is all that moves.
 */
export function rotatedOffset(offset: Vec3, orientation: Pick<Orientation, "euler">): Vec3 {
  const m = rotationMatrix(orientation);
  const at = (row: number) => m[row][0] * offset[0] + m[row][1] * offset[1] + m[row][2] * offset[2] + 0; // + 0: no negative zero
  return [at(0), at(1), at(2)];
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
