import { Box3, Euler, Matrix4, Vector3 } from "three";
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

/**
 * Bounding-box size of a part after rotation. Uses the same three.js math as
 * the renderer, so the packing result and the 3D view can't disagree.
 */
export function rotatedSize(size: Vec3, orientation: Orientation): Vec3 {
  const half = new Vector3(...size).multiplyScalar(0.5);
  const box = new Box3(half.clone().negate(), half);
  box.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...orientation.euler)));
  const out = box.getSize(new Vector3());
  // Round off floating-point noise from sin/cos of π/2.
  return [round(out.x), round(out.y), round(out.z)];
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
