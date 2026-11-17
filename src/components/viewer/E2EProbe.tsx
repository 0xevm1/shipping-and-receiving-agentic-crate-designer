"use client";

/**
 * Read-only test hook for the Playwright suite (#34). Loaded only in builds made with
 * `NEXT_PUBLIC_E2E=1` (see `CrateViewer`); normal builds don't include this module.
 *
 * The 3D scene can't be read from the DOM, so this exposes `window.__crate`:
 * - `getState()`: a plain snapshot (copies, never live objects) of the view mode, camera,
 *   hover / pin keys, the eased `anim` values, the crate's outside size and the dimension-line
 *   pulse counters (#65), and the centre of gravity and fork-entry marks (#8).
 * - `canvasCoverage()`: the share of canvas pixels the scene drew on, proving WebGL renders.
 * Nothing here writes to the store or the scene.
 */
import { useFrame, useThree, type RootState } from "@react-three/fiber";
import { useEffect } from "react";
import { Spherical, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { lastProfileMs } from "@/lib/partProfile";
import { anim, autoplay, isIdle, pulse } from "@/state/motion";
import { currentMode, useDesigner } from "@/state/store";
import { handlingMarks } from "./HandlingMarks";

export interface CrateSnapshot {
  /** Mode from the view targets, or null for a custom mix. */
  mode: ReturnType<typeof currentMode>;
  view: { lid: boolean; front: boolean; explode: number; blocking: boolean; parts: boolean; dims: boolean; camera: string | null };
  /** Camera distance to the orbit target, in m; null while no scene is mounted. */
  cameraDistance: number | null;
  /** three.js spherical angles of the camera around the target (θ around Y, φ down from +Y). */
  cameraAngles: { theta: number; phi: number } | null;
  /** Orbit target (what the camera looks at), three.js metres. */
  cameraTarget: [number, number, number] | null;
  pin: string | null;
  hoverKey: string | null;
  hoverAssembly: string | null;
  anim: { explode: number; lidAlpha: number; frontAlpha: number };
  autoplay: boolean;
  /** No deliberate input for `IDLE_MS` (hovering doesn't count, #64). */
  idle: boolean;
  /** `result.design.layout.external`, mm; null when there is a problem instead of a design. */
  outside: [number, number, number] | null;
  problem: string | null;
  tab: string;
  units: string;
  panelsHidden: boolean;
  /** Narrow screens: the island drawer is open (#42). */
  drawerOpen: boolean;
  quantity: number;
  /** The shipment plan's crate types (#25): one for a single crate. */
  crateTypes: { label: string; count: number; quantity: number }[];
  /** Index of the crate type on screen. */
  crateIndex: number;
  /** Parts in the crate on screen. */
  crateParts: number | null;
  partId: string;
  massAssumed: boolean;
  /** Frames rendered since the scene mounted. */
  frames: number;
  /** Dimension-line photon pulses fired since the page loaded (#65). */
  pulses: number;
  /** Photons on screen in the last frame (#65). */
  photonsActive: number;
  /** The design's blocking is shaped to a measured part profile (#16). */
  shapedBlocking: boolean;
  /** Milliseconds the last part analysis took in this page (#16); null before any. */
  profileMs: number | null;
  /**
   * Centre of gravity (#8): the design's, crate-interior mm, and what the 3D view draws (`marker`
   * is the CoG mark's position, null while hidden; `arrows` the fork-entry arrows on screen).
   */
  cog: { mm: [number, number, number]; marker: [number, number, number] | null; arrows: number } | null;
}

declare global {
  interface Window {
    __crate?: { getState: () => CrateSnapshot; canvasCoverage: () => number };
  }
}

let getThree: (() => RootState) | null = null;
let frames = 0;
const sph = new Spherical();
const offset = new Vector3();

function snapshot(): CrateSnapshot {
  const s = useDesigner.getState();
  const three = getThree?.();
  const camera = three?.camera;
  const target = (three?.controls as OrbitControlsImpl | null)?.target;
  let cameraDistance: number | null = null;
  let cameraAngles: CrateSnapshot["cameraAngles"] = null;
  if (camera && target) {
    sph.setFromVector3(offset.copy(camera.position).sub(target));
    cameraDistance = sph.radius;
    cameraAngles = { theta: sph.theta, phi: sph.phi };
  }
  const external = s.result.design?.layout.external;
  return {
    mode: currentMode(s.view),
    view: { ...s.view },
    cameraDistance,
    cameraAngles,
    cameraTarget: target ? [target.x, target.y, target.z] : null,
    pin: s.pin,
    hoverKey: s.hover?.key ?? null,
    hoverAssembly: s.hover?.assembly ?? null,
    anim: { ...anim },
    autoplay: autoplay.on,
    idle: isIdle(),
    outside: external ? [external[0], external[1], external[2]] : null,
    problem: s.result.problem?.id ?? null,
    tab: s.tab,
    units: s.units,
    panelsHidden: s.panelsHidden,
    drawerOpen: s.drawerOpen,
    quantity: s.settings.quantity,
    crateTypes: s.plan.crates.map(({ label, count, quantity }) => ({ label, count, quantity })),
    crateIndex: s.crateIndex,
    crateParts: s.result.design?.layout.slots.length ?? null,
    partId: s.part.id,
    massAssumed: s.part.massAssumed,
    frames,
    pulses: pulse.fired,
    photonsActive: pulse.active,
    shapedBlocking: !!s.result.design?.shapedBlocking,
    profileMs: lastProfileMs,
    cog: s.result.design
      ? {
          mm: [...s.result.design.centerOfGravityMm],
          marker: handlingMarks.cog ? [...handlingMarks.cog] : null,
          arrows: handlingMarks.arrows,
        }
      : null,
  };
}

/** Renders one frame and reads it back at once (before the buffer is cleared); share of pixels with any alpha. */
function canvasCoverage(): number {
  if (!getThree) return 0;
  const { gl, scene, camera } = getThree();
  gl.render(scene, camera);
  const ctx = gl.getContext();
  const w = ctx.drawingBufferWidth;
  const h = ctx.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
  let drawn = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) drawn++;
  return drawn / (w * h);
}

export default function E2EProbe() {
  const get = useThree((s) => s.get);

  useEffect(() => {
    getThree = get;
    window.__crate = Object.freeze({ getState: snapshot, canvasCoverage });
    return () => {
      getThree = null;
      frames = 0;
    };
  }, [get]);

  useFrame(() => {
    frames++;
  });

  return null;
}
