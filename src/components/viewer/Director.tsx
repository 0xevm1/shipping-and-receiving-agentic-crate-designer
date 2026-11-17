"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { MathUtils, Spherical, Vector3, type PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  anim,
  autoplay,
  EASE_FAST,
  EASE_SLOW,
  IDLE_LEAD,
  IDLE_SEQUENCE,
  IDLE_TURN_RATE,
  isIdle,
  pointer,
} from "@/state/motion";
import { currentMode, reducedMotion, useDesigner, type CameraPreset, type DesignerState } from "@/state/store";
import type { CrateDesign } from "@/domain/crate";
import { crateLabelAnchors } from "./DimensionLines";
import { EXPLODE_LID_MM, EXPLODE_WALL_MM, sceneOrigin } from "./scene";

export const FOV_DEG = 34;
const MM_TO_M = 0.001;
/** Far clipping plane in m (the canvas default), pushed out for very large crates. */
const FAR_M = 200;

/** three.js spherical angles: θ around Y from +Z toward +X, φ down from +Y. Domain front (−Y) faces +Z. */
const PRESETS: Record<CameraPreset, { theta: number; phi: number }> = {
  iso: { theta: 0.55, phi: Math.PI / 2 - 0.46 },
  top: { theta: 0, phi: 0.002 },
  front: { theta: 0, phi: Math.PI / 2 - 0.02 },
  end: { theta: -Math.PI / 2, phi: Math.PI / 2 - 0.02 },
};

interface Goal {
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
const MODE_ZOOM = { closed: 0.68, open: 0.8, exploded: 1 } as const;
/** Hiding the panels brings the camera in a further step. */
const PANELS_HIDDEN_ZOOM = 0.82;

const tmp = new Vector3();
const sph = new Spherical();

/**
 * Drives everything that moves on its own:
 * - centres the crate in the area the panels leave free (camera view offset),
 * - re-frames the camera on request (`fit` in the store), easing to the goal,
 * - eases the explode distance and lid / front-wall opacity toward the view targets,
 * - idle auto-play: after 5 s without deliberate input the crate turns and steps through
 *   closed → exploded → open → exploded, half a turn per mode. It holds while a row is pinned,
 *   during a drag, or while the narrow-screen drawer is open (#42). Hovering doesn't hold it
 *   (#64): while it turns under a still pointer the scene re-picks, so the hover follows the boards.
 */
export function Director() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const getThree = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const insets = useDesigner((s) => s.insets);
  const fit = useDesigner((s) => s.fit);
  const goal = useRef<Goal | null>(null);
  /** The orbit target last placed, kept for when the controls aren't registered yet. */
  const aim = useRef(new Vector3());
  const dragging = useRef(false);
  /** Seconds since the last re-pick under a still pointer. */
  const sincePick = useRef(0);

  // Shift the projection so the crate sits in the middle of the free area, not the window.
  useEffect(() => {
    const { width: W, height: H } = size;
    const cx = insets.left + (W - insets.left - insets.right) / 2;
    const cy = insets.top + (H - insets.top - insets.bottom) / 2;
    camera.setViewOffset(W, H, -(cx - W / 2), -(cy - H / 2), W, H);
    camera.updateProjectionMatrix();
  }, [camera, size, insets]);

  // User orbiting cancels any camera move in flight and the active preset.
  useEffect(() => {
    if (!controls) return;
    const start = () => {
      dragging.current = true;
      goal.current = null;
      const s = useDesigner.getState();
      if (s.view.camera) s.setView({ camera: null });
    };
    const end = () => void (dragging.current = false);
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => {
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
    };
  }, [controls]);

  // OrbitControls registers as the default controls after the first render, so the first fit
  // runs without them (#43). `place` keeps the target here meanwhile, and the controls take it
  // over as soon as they exist; otherwise they keep aiming at the floor (0, 0, 0).
  useEffect(() => {
    if (!controls) return;
    controls.target.copy(aim.current);
    controls.update();
  }, [controls]);

  const place = (g: Goal) => {
    sph.set(g.radius, g.phi, g.theta);
    camera.position.copy(g.target).add(tmp.setFromSpherical(sph));
    camera.lookAt(g.target);
    aim.current.copy(g.target);
    if (controls) {
      controls.target.copy(g.target);
      controls.update();
    }
  };

  const currentAngles = () => {
    const target = controls?.target ?? aim.current;
    sph.setFromVector3(tmp.copy(camera.position).sub(target));
    return { theta: sph.theta, phi: sph.phi, radius: sph.radius, target: target.clone() };
  };

  useEffect(() => {
    const s = useDesigner.getState();
    const g = fitGoal(s, size.height, size.width, currentAngles());
    if (!g) return;
    // Keep a very large crate and its floor grid inside the far plane.
    const far = Math.max(FAR_M, g.radius * 4);
    const cam = getThree().camera as PerspectiveCamera;
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    if (fit.instant || reducedMotion()) {
      goal.current = null;
      place(g);
    } else {
      goal.current = g;
    }
    // Re-frame only on request or resize; reading the rest live from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.nonce, size.width, size.height]);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.1, rawDt);
    const s = useDesigner.getState();
    const reduce = reducedMotion();

    if (s.result.design && !reduce && !dragging.current && !s.pin && !s.drawerOpen && (autoplay.on || isIdle())) {
      if (!autoplay.on || autoplay.step < 0) {
        autoplay.on = true;
        autoplay.turned = 0;
        autoplay.fired = false;
        autoplay.step = Math.max(0, IDLE_SEQUENCE.indexOf(currentMode(s.view) ?? "closed"));
      }
      const da = dt * IDLE_TURN_RATE;
      const now = currentAngles();
      place({ ...now, theta: now.theta + da });
      if (goal.current) goal.current.theta += da;
      autoplay.turned += da;
      if (!autoplay.fired && autoplay.turned > Math.PI - IDLE_LEAD) {
        autoplay.fired = true;
        autoplay.slow = true;
        s.setMode(IDLE_SEQUENCE[(autoplay.step + 1) % IDLE_SEQUENCE.length]);
      }
      if (autoplay.turned >= Math.PI) {
        autoplay.turned = 0;
        autoplay.fired = false;
        autoplay.step = (autoplay.step + 1) % IDLE_SEQUENCE.length;
      }
      // The pointer is still but the boards move under it: re-pick ~10×/s so the tooltip and
      // highlight follow (r3f only raycasts on pointer events). Throttled: parts are detailed meshes.
      sincePick.current += dt;
      if (pointer.inCanvas && sincePick.current >= 0.1) {
        sincePick.current = 0;
        getThree().events.update?.();
      }
    }

    const k = reduce ? 1 : 1 - Math.exp(-dt * (autoplay.slow ? EASE_SLOW : EASE_FAST));
    anim.lidAlpha = approach(anim.lidAlpha, s.view.lid ? 1 : 0, k, 0.01);
    anim.frontAlpha = approach(anim.frontAlpha, s.view.front ? 1 : 0, k, 0.01);
    anim.explode = approach(anim.explode, s.view.explode, k, 0.004);

    const g = goal.current;
    if (g) {
      const now = currentAngles();
      const kc = autoplay.slow ? k : 1 - Math.exp(-dt * EASE_FAST);
      let dTheta = g.theta - now.theta;
      while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
      const next: Goal = {
        theta: now.theta + dTheta * kc,
        phi: now.phi + (g.phi - now.phi) * kc,
        radius: now.radius + (g.radius - now.radius) * kc,
        target: now.target.lerp(g.target, kc),
      };
      place(next);
      if (Math.abs(dTheta) < 0.001 && Math.abs(g.phi - now.phi) < 0.001 && Math.abs(g.radius - now.radius) < 0.001) {
        goal.current = null;
      }
    }
  });

  return null;
}

function approach(v: number, target: number, k: number, snap: number) {
  const next = v + (target - v) * k;
  return Math.abs(target - next) < snap ? target : next;
}

/**
 * Camera framing for the crate at the current explode target: fit the bounding
 * sphere of everything on screen (exploded pieces, size labels) into the free
 * area, using the tighter of its width and height, then move in by the mode's
 * zoom (and further when the panels are hidden).
 */
function fitGoal(s: DesignerState, H: number, W: number, now: { theta: number; phi: number }): Goal | null {
  const d = s.result.design;
  if (!d) return null;
  const e = s.view.explode;
  const ext = d.layout.external;
  const longest = Math.max(...ext);
  const pad = s.view.dims ? 2 * (110 + longest * 0.05) + 160 : 0;
  const spanMm = [ext[0] + 2 * EXPLODE_WALL_MM * e + pad, ext[1] + 2 * EXPLODE_WALL_MM * e + pad, ext[2] + EXPLODE_LID_MM * e];
  const r = (Math.hypot(...spanMm) / 2) * MM_TO_M;

  const fw = Math.max(240, W - s.insets.left - s.insets.right);
  const fh = Math.max(240, H - s.insets.top - s.insets.bottom);
  const t = Math.tan(MathUtils.degToRad(FOV_DEG / 2));
  const half = Math.min(Math.atan((t * fh) / H), Math.atan((t * fw) / H));

  const angles = s.view.camera ? PRESETS[s.view.camera] : now;
  // Mode from the view targets; a custom mix is treated by its nearest mode.
  const mode = e > 0.5 ? "exploded" : s.view.lid ? "closed" : "open";
  const zoom = MODE_ZOOM[mode] * (s.panelsHidden ? PANELS_HIDDEN_ZOOM : 1);
  const target = new Vector3(0, (ext[2] / 2 + (EXPLODE_LID_MM / 2) * e) * MM_TO_M, 0);
  const theta = autoplay.on ? now.theta : angles.theta;
  let radius = (r / Math.sin(half)) * 0.9 * zoom;
  if (s.view.dims) radius = Math.max(radius, labelRadius(d, e, target, theta, angles.phi, { fw, fh, H }, t));
  return { target, theta, phi: angles.phi, radius };
}

/**
 * Half a crate size label's screen size plus a small gap, px. A `.dim` pill (12 px mono,
 * globals.css) reads "1692 mm" or "66.6 in" at about 70 × 20 px.
 */
const LABEL_HALF_PX = { x: 44, y: 14 };
const UP = new Vector3(0, 1, 0);
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const q = new Vector3();

/**
 * The closest camera distance, looking from (`theta`, `phi`) at `target`, at which every crate
 * size label sits wholly inside the free area (#43). The sphere fit covers the label anchors but
 * not the labels' own size, and the closer mode zooms crop it, so a long crate's end labels
 * could land under the island. The view offset puts `target` at the middle of the free area, so
 * a point at camera-space (x, y) and depth z lands `x / z · (H / 2) / tan(fov / 2)` px from it
 * horizontally (likewise for y); solving for the depth that keeps the label inside gives the
 * distance. Returns 0 when nothing constrains it.
 */
function labelRadius(
  d: CrateDesign,
  e: number,
  target: Vector3,
  theta: number,
  phi: number,
  free: { fw: number; fh: number; H: number },
  tanHalfFov: number,
): number {
  // Camera axes as `lookAt` builds them: z from the target toward the camera.
  axisZ.setFromSpherical(sph.set(1, phi, theta));
  axisX.crossVectors(UP, axisZ).normalize();
  axisY.crossVectors(axisZ, axisX);
  const px = free.H / 2 / tanHalfFov;
  const roomX = Math.max(20, free.fw / 2 - LABEL_HALF_PX.x) / px;
  const roomY = Math.max(20, free.fh / 2 - LABEL_HALF_PX.y) / px;
  const o = sceneOrigin(d);
  let need = 0;
  for (const a of crateLabelAnchors(d, e)) {
    // Domain (Z up, mm) → three.js (Y up, m), as the scene's root group does.
    q.set(a[0] + o[0], a[2] + o[2], -(a[1] + o[1])).multiplyScalar(MM_TO_M).sub(target);
    const depth = Math.max(Math.abs(q.dot(axisX)) / roomX, Math.abs(q.dot(axisY)) / roomY);
    need = Math.max(need, q.dot(axisZ) + depth);
  }
  return need;
}
