import type { Vec3 } from "./schema";

const Q = Math.PI / 2;

/**
 * A face of the part's bounding box in the part's own frame (the loaded model after the file's
 * units and up axis, `partFrame.ts`): "-z" is the base as modelled, "+z" the top, "-y" the front,
 * "+y" the back, "-x" the left end and "+x" the right end. A part "rests on" the face that is
 * down in the crate.
 */
export const RESTING_FACES = ["-z", "+z", "-y", "+y", "-x", "+x"] as const;
export type RestingFace = (typeof RESTING_FACES)[number];

/** Any face may be down (the old "Keep parts upright" off). */
export const ANY_FACES: readonly RestingFace[] = [...RESTING_FACES];
/** Only the face the model sits on (the old "Keep parts upright" on, and the default). */
export const AS_MODELLED_FACES: readonly RestingFace[] = ["-z"];

export interface Orientation {
  id: string;
  label: string;
  /** Euler angles (radians, XYZ order) applied to the part in the crate frame. */
  euler: [number, number, number];
  /** True when the part's modeled Z axis stays vertical (right way up or upside down). */
  upright: boolean;
}

/**
 * The axis-aligned orientations of a box, as (face down) × (a quarter turn about the vertical).
 * The first six are one per axis permutation (so one per extents the box can have); saved layout
 * keys name them, so they stay first and unchanged. Between them they rest the part on -z (twice),
 * -y (twice), -x and +x. The second six turn each one over, so the opposite face is down (same
 * extents, so the same layouts): every face is down in exactly two orientations, and a part that may
 * rest only on its +z face still has some. Mirror images are excluded since they aren't rotations.
 */
export const ORIENTATIONS: Orientation[] = [
  { id: "as-modeled", label: "As modeled", euler: [0, 0, 0], upright: true },
  { id: "turned", label: "Turned 90°", euler: [0, 0, Q], upright: true },
  { id: "on-side-x", label: "On its side", euler: [Q, 0, 0], upright: false },
  { id: "on-side-x-turned", label: "On its side, turned 90°", euler: [Q, 0, Q], upright: false },
  { id: "on-end-y", label: "On end", euler: [0, Q, 0], upright: false },
  { id: "on-end-y-turned", label: "On end, turned 90°", euler: [0, Q, Q], upright: false },
  { id: "upside-down", label: "Upside down", euler: [2 * Q, 0, 0], upright: true },
  { id: "upside-down-turned", label: "Upside down, turned 90°", euler: [2 * Q, 0, Q], upright: true },
  { id: "on-other-side", label: "On its other side", euler: [-Q, 0, 0], upright: false },
  { id: "on-other-side-turned", label: "On its other side, turned 90°", euler: [-Q, 0, Q], upright: false },
  { id: "on-other-end", label: "On its other end", euler: [0, -Q, 0], upright: false },
  { id: "on-other-end-turned", label: "On its other end, turned 90°", euler: [0, -Q, Q], upright: false },
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

/** The part's face that is down (rests on the crate floor) in this orientation. */
export function restingFace(orientation: Pick<Orientation, "euler">): RestingFace {
  const row = rotationMatrix(orientation)[2];
  // The crate's up axis in the part's frame is the third row; the part's face looking the other way is down.
  const axis = row.findIndex((v) => v !== 0);
  return `${row[axis] > 0 ? "-" : "+"}${"xyz"[axis]}` as RestingFace;
}

/** The orientations saved layout keys already named: the first six of `ORIENTATIONS`. */
const ORIGINAL_ORIENTATIONS = 6;

/** True for the six orientations added for the faces the first six don't rest on (same extents as one of them). */
export function isFlipped(orientation: Pick<Orientation, "id">): boolean {
  return ORIENTATIONS.findIndex((o) => o.id === orientation.id) >= ORIGINAL_ORIENTATIONS;
}

/** The orientations that rest the part on one of `faces`. */
export function orientationsFor(faces: readonly RestingFace[]): Orientation[] {
  return ORIENTATIONS.filter((o) => faces.includes(restingFace(o)));
}

/** The faces in the canonical order without repeats; null when the list is empty or holds anything else. */
export function canonicalFaces(faces: readonly unknown[]): RestingFace[] | null {
  const all: readonly unknown[] = RESTING_FACES;
  if (faces.length === 0 || !faces.every((f) => all.includes(f))) return null;
  return RESTING_FACES.filter((f) => faces.includes(f));
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

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
