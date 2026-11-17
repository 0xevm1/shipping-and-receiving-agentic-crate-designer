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
} from "@/state/motion";
import { currentMode, reducedMotion, useDesigner, type CameraPreset, type DesignerState } from "@/state/store";
import { EXPLODE_LID_MM, EXPLODE_WALL_MM } from "./scene";

export const FOV_DEG = 34;
const MM_TO_M = 0.001;

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
 * - idle auto-play: after 6 s without input the crate turns and steps through
 *   closed → exploded → open → exploded, half a turn per mode.
 */
export function Director() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);
  const insets = useDesigner((s) => s.insets);
  const fit = useDesigner((s) => s.fit);
  const goal = useRef<Goal | null>(null);
  const dragging = useRef(false);

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

  const place = (g: Goal) => {
    sph.set(g.radius, g.phi, g.theta);
    camera.position.copy(g.target).add(tmp.setFromSpherical(sph));
    camera.lookAt(g.target);
    if (controls) {
      controls.target.copy(g.target);
      controls.update();
    }
  };

  const currentAngles = () => {
    const target = controls?.target ?? new Vector3();
    sph.setFromVector3(tmp.copy(camera.position).sub(target));
    return { theta: sph.theta, phi: sph.phi, radius: sph.radius, target: target.clone() };
  };

  useEffect(() => {
    const s = useDesigner.getState();
    const g = fitGoal(s, size.height, size.width, currentAngles());
    if (!g) return;
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

    if (s.result.design && !reduce && !dragging.current && !s.pin && !s.hover && (autoplay.on || isIdle())) {
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
  return {
    target: new Vector3(0, (ext[2] / 2 + (EXPLODE_LID_MM / 2) * e) * MM_TO_M, 0),
    theta: autoplay.on ? now.theta : angles.theta,
    phi: angles.phi,
    radius: (r / Math.sin(half)) * 0.9 * zoom,
  };
}
