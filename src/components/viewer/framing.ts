/**
 * Camera framing: where the camera goes to show the crate in the area the panels leave free.
 * Pure maths (three.js vectors, no React, no store), so it is unit-tested directly; `Director`
 * applies the result and animates towards it.
 */
import { MathUtils, Spherical, Vector3 } from "three";
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { currentMode, type CameraPreset, type Insets, type Mode, type ViewState } from "@/state/store";
import { crateLabelAnchors, labelOffsetMm } from "./sizeLines";
import { arrowReachMm } from "./forkArrows";
import { domainToWorld, EXPLODE_LID_MM, EXPLODE_WALL_MM, FOV_DEG, MM_TO_M, sceneOrigin } from "./scene";

/** three.js spherical angles: θ around Y from +Z toward +X, φ down from +Y. Domain front (−Y) faces +Z. */
export const PRESETS: Record<CameraPreset, { theta: number; phi: number }> = {
  iso: { theta: 0.55, phi: Math.PI / 2 - 0.46 },
  top: { theta: 0, phi: 0.002 },
  front: { theta: 0, phi: Math.PI / 2 - 0.02 },
  end: { theta: -Math.PI / 2, phi: Math.PI / 2 - 0.02 },
};

export interface Goal {
  target: Vector3;
  theta: number;
  phi: number;
  radius: number;
}

/**
 * Camera distance per mode, as a fraction of the distance that just fits the
 * whole scene. Exploded needs the room; open comes in closer to show the
 * inside; closed is a close look at the crate itself.
 */
export const MODE_ZOOM: Record<Mode, number> = { closed: 0.68, open: 0.8, exploded: 1 };
/** Hiding the panels brings the camera in a further step. */
export const PANELS_HIDDEN_ZOOM = 0.82;

/** The mode whose zoom applies: the view's own, or for a custom mix the nearest one. */
export function zoomMode(v: Pick<ViewState, "lid" | "front" | "explode">): Mode {
  return currentMode(v) ?? (v.explode > 0.5 ? "exploded" : v.lid ? "closed" : "open");
}

/**
 * Half a crate size label's screen size plus a small gap, px. A `.dim` pill (12 px mono,
 * globals.css) reads "1692 mm" or "66.6 in" at about 70 × 20 px.
 */
export const LABEL_HALF_PX = { x: 44, y: 14 };
/** Half the room kept around the tail of a fork arrow, px. */
const ARROW_HALF_PX = { x: 10, y: 6 };

/** A point the camera must keep on screen (crate-interior mm) and the room it needs around it, px. */
export interface Keep {
  at: Vec3;
  halfPx: { x: number; y: number };
}

/**
 * What must stay on screen at explode amount `e`: the crate's size labels, and (with the size
 * labels on) the tail of each fork arrow, which stands out past them and slides out with the
 * end walls.
 */
export function keepInView(design: CrateDesign, e: number): Keep[] {
  const keep: Keep[] = crateLabelAnchors(design, e).map((at) => ({ at, halfPx: LABEL_HALF_PX }));
  const ext = design.layout.external;
  const edge = design.construction.panelMm + design.construction.cleat.thick;
  const reach = arrowReachMm(ext);
  const out = EXPLODE_WALL_MM * e;
  const z = design.handling.groundZ;
  for (const o of design.handling.openings) {
    const y = o.y + o.width / 2;
    keep.push({ at: [-edge - reach - out, y, z], halfPx: ARROW_HALF_PX });
    keep.push({ at: [-edge + ext[0] + reach + out, y, z], halfPx: ARROW_HALF_PX });
  }
  return keep;
}

/** The free area the panels leave, px, and the canvas height the projection scale comes from. */
export interface FreeArea {
  fw: number;
  fh: number;
  H: number;
}

export function freeArea(width: number, height: number, insets: Insets): FreeArea {
  return {
    fw: Math.max(240, width - insets.left - insets.right),
    fh: Math.max(240, height - insets.top - insets.bottom),
    H: height,
  };
}

/** Where `setViewOffset` shifts the projection so the crate sits in the middle of the free area. */
export function viewOffset(width: number, height: number, insets: Insets): { x: number; y: number } {
  const cx = insets.left + (width - insets.left - insets.right) / 2;
  const cy = insets.top + (height - insets.top - insets.bottom) / 2;
  return { x: -(cx - width / 2), y: -(cy - height / 2) };
}

export interface FrameRequest {
  design: CrateDesign;
  view: Pick<ViewState, "lid" | "front" | "explode" | "camera" | "dims">;
  panelsHidden: boolean;
  insets: Insets;
  width: number;
  height: number;
  /** The camera's current angles; kept where the preset doesn't set them. */
  now: { theta: number; phi: number };
  /** Auto-play is turning the crate: keep its heading instead of the preset's. */
  keepHeading: boolean;
}

/**
 * Camera framing for the crate at the current explode target: fit the bounding sphere of
 * everything on screen (exploded pieces, size labels) into the free area, using the tighter of
 * its width and height, then move in by the mode's zoom (and further when the panels are
 * hidden). With size labels on, back off further if a label or arrow tail would still land
 * outside the free area.
 */
export function fitGoal(req: FrameRequest): Goal {
  const { design, view, now } = req;
  const e = view.explode;
  const ext = design.layout.external;
  const pad = view.dims ? 2 * labelOffsetMm(ext) + 160 : 0;
  const spanMm = [ext[0] + 2 * EXPLODE_WALL_MM * e + pad, ext[1] + 2 * EXPLODE_WALL_MM * e + pad, ext[2] + EXPLODE_LID_MM * e];
  const r = (Math.hypot(...spanMm) / 2) * MM_TO_M;

  const free = freeArea(req.width, req.height, req.insets);
  const t = Math.tan(MathUtils.degToRad(FOV_DEG / 2));
  const half = Math.min(Math.atan((t * free.fh) / free.H), Math.atan((t * free.fw) / free.H));

  const angles = view.camera ? PRESETS[view.camera] : now;
  const zoom = MODE_ZOOM[zoomMode(view)] * (req.panelsHidden ? PANELS_HIDDEN_ZOOM : 1);
  const target = new Vector3(0, (ext[2] / 2 + (EXPLODE_LID_MM / 2) * e) * MM_TO_M, 0);
  const theta = req.keepHeading ? now.theta : angles.theta;
  let radius = (r / Math.sin(half)) * 0.9 * zoom;
  if (view.dims) radius = Math.max(radius, keepRadius(design, keepInView(design, e), target, theta, angles.phi, free, t));
  return { target, theta, phi: angles.phi, radius };
}

const UP = new Vector3(0, 1, 0);
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const q = new Vector3();
const sph = new Spherical();

/**
 * The closest camera distance, looking from (`theta`, `phi`) at `target`, at which every `keep`
 * point sits wholly inside the free area. The sphere fit covers the points but not the labels'
 * own size, and the closer mode zooms crop it, so a long crate's end labels could land under the
 * island. The view offset puts `target` at the middle of the free area, so a point at camera-space
 * (x, y) and depth z lands `x / z · (H / 2) / tan(fov / 2)` px from it horizontally (likewise for
 * y); solving for the depth that keeps the point's room inside gives the distance. Returns 0
 * when nothing constrains it.
 */
export function keepRadius(
  design: CrateDesign,
  keep: readonly Keep[],
  target: Vector3,
  theta: number,
  phi: number,
  free: FreeArea,
  tanHalfFov: number,
): number {
  // Camera axes as `lookAt` builds them: z from the target toward the camera.
  axisZ.setFromSpherical(sph.set(1, phi, theta));
  axisX.crossVectors(UP, axisZ).normalize();
  axisY.crossVectors(axisZ, axisX);
  const px = free.H / 2 / tanHalfFov;
  const o = sceneOrigin(design);
  let need = 0;
  for (const { at, halfPx } of keep) {
    const roomX = Math.max(20, free.fw / 2 - halfPx.x) / px;
    const roomY = Math.max(20, free.fh / 2 - halfPx.y) / px;
    domainToWorld([at[0] + o[0], at[1] + o[1], at[2] + o[2]], q).sub(target);
    const depth = Math.max(Math.abs(q.dot(axisX)) / roomX, Math.abs(q.dot(axisY)) / roomY);
    need = Math.max(need, q.dot(axisZ) + depth);
  }
  return need;
}

/** Eases `v` toward `target` by `k`, snapping once within `snap`. */
export function approach(v: number, target: number, k: number, snap: number): number {
  const next = v + (target - v) * k;
  return Math.abs(target - next) < snap ? target : next;
}

/** The signed angle in (−π, π] that turns `from` the short way round to `to`. */
export function shortestAngle(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
