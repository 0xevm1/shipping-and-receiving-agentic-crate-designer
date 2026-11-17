"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Spherical, Vector3, type PerspectiveCamera } from "three";
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
import { currentMode, reducedMotion, useDesigner } from "@/state/store";
import { approach, fitGoal, shortestAngle, viewOffset, type Goal } from "./framing";
import { CAMERA_FAR_M } from "./scene";

const tmp = new Vector3();
const sph = new Spherical();

/**
 * Drives everything that moves on its own:
 * - centres the crate in the area the panels leave free (camera view offset),
 * - re-frames the camera on request (`fit` in the store), easing to the goal,
 * - eases the explode distance and lid / front-wall opacity toward the view targets,
 * - idle auto-play: after 5 s without deliberate input the crate turns and steps through
 *   closed → exploded → open → exploded, half a turn per mode. It holds while a row is pinned,
 *   during a drag, or while the narrow-screen drawer is open. Hovering doesn't hold it: while it
 *   turns under a still pointer the scene re-picks, so the hover follows the boards.
 */
export function Director({ active }: { active: boolean }) {
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
    const o = viewOffset(W, H, insets);
    camera.setViewOffset(W, H, o.x, o.y, W, H);
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
    const end = () => {
      dragging.current = false;
    };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => {
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
    };
  }, [controls]);

  // OrbitControls registers as the default controls after the first render, so the first fit
  // runs without them. `place` keeps the target here meanwhile, and the controls take it
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
    if (!active || !s.result.design) return;
    const g = fitGoal({
      design: s.result.design,
      view: s.view,
      panelsHidden: s.panelsHidden,
      insets: s.insets,
      width: size.width,
      height: size.height,
      now: currentAngles(),
      keepHeading: autoplay.on,
    });
    // Keep a very large crate and its floor grid inside the far plane.
    const far = Math.max(CAMERA_FAR_M, g.radius * 4);
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
  }, [fit.nonce, size.width, size.height, active]);

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
      const dTheta = shortestAngle(now.theta, g.theta);
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
