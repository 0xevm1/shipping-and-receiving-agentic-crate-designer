"use client";

/**
 * Test hook for the Playwright suite. Loaded only in builds made with `NEXT_PUBLIC_E2E=1` (see
 * `CrateViewer`); normal builds don't include this module.
 *
 * The 3D scene can't be read from the DOM, so this exposes `window.__crate`:
 * - `getState()`: a plain snapshot (copies, never live objects) of the view, the camera, the
 *   eased `anim` values, the store's design and shipment, and what the scene reports in
 *   `probeStats` (pulses, photons, fork arrows).
 * - `canvasCoverage()`: the share of canvas pixels the scene drew on, proving WebGL renders.
 * Nothing here writes to the store or the scene.
 */
import { useFrame, useThree, type RootState } from "@react-three/fiber";
import { useEffect } from "react";
import { Box2, Spherical, Vector2, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Vec3 } from "@/domain/schema";
import { lastProfileMs } from "@/lib/partProfile";
import type { Units } from "@/lib/units";
import { anim, autoplay, isIdle } from "@/state/motion";
import { currentMode, useDesigner, type Tab, type ViewState } from "@/state/store";
import { probeStats } from "./probeStats";
import { domainToWorld, sceneOrigin } from "./scene";

export interface CrateSnapshot {
  /** Mode from the view targets, or null for a custom mix. */
  mode: ReturnType<typeof currentMode>;
  view: ViewState;
  /** Camera distance to the orbit target, in m; null while no scene is mounted. */
  cameraDistance: number | null;
  /** three.js spherical angles of the camera around the target (θ around Y, φ down from +Y). */
  cameraAngles: { theta: number; phi: number } | null;
  /** Orbit target (what the camera looks at), three.js metres. */
  cameraTarget: Vec3 | null;
  pin: string | null;
  hoverKey: string | null;
  hoverAssembly: string | null;
  anim: { explode: number; lidAlpha: number; frontAlpha: number };
  autoplay: boolean;
  /** No deliberate input for `IDLE_MS` (hovering doesn't count). */
  idle: boolean;
  /** `result.design.layout.external`, mm; null when there is a problem instead of a design. */
  outside: Vec3 | null;
  problem: string | null;
  tab: Tab;
  units: Units;
  panelsHidden: boolean;
  /** Narrow screens: the island drawer is open. */
  drawerOpen: boolean;
  quantity: number;
  /** The shipment plan's crate types: one for a single crate. */
  crateTypes: { label: string; count: number; quantity: number }[];
  /** Index of the crate type on screen. */
  crateIndex: number;
  /** Parts in the crate on screen. */
  crateParts: number | null;
  partId: string;
  massAssumed: boolean;
  /** The crate's outside box projected onto the canvas, CSS px; null with no design or camera. */
  crateScreen: { left: number; top: number; right: number; bottom: number } | null;
  /** Frames rendered since the scene mounted. */
  frames: number;
  /** Dimension-line photon pulses fired since the page loaded. */
  pulses: number;
  /** Photons on screen in the last frame. */
  photonsActive: number;
  /** The design's blocking is shaped to a measured part profile. */
  shapedBlocking: boolean;
  /** Milliseconds the last part analysis took in this page; null before any. */
  profileMs: number | null;
  /**
   * Centre of gravity: the design's, crate-interior mm, and what the 3D view draws (`marker` is
   * the CoG mark's position, null while hidden; `arrows` the fork-entry arrows mounted and
   * `arrowsShown` those the crate isn't hiding).
   */
  cog: {
    mm: Vec3;
    marker: Vec3 | null;
    arrows: number;
    arrowsShown: number;
    /** The near-end (+X) arrow's screen box in CSS px, from the last frame; null before one. */
    arrowBox: { left: number; top: number; right: number; bottom: number } | null;
  } | null;
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

const corner = new Vector3();

/** The crate's outside box (its members' extent) as the camera sees it, CSS px. */
function projectCrate(three: RootState | undefined): CrateSnapshot["crateScreen"] {
  const design = useDesigner.getState().result.design;
  if (!three || !design) return null;
  const lo = [0, 1, 2].map((i) => Math.min(...design.members.map((m) => m.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...design.members.map((m) => m.min[i] + m.size[i])));
  const o = sceneOrigin(design);
  const box = new Box2();
  for (const x of [lo[0], hi[0]])
    for (const y of [lo[1], hi[1]])
      for (const z of [lo[2], hi[2]]) {
        domainToWorld([x + o[0], y + o[1], z + o[2]], corner).project(three.camera);
        box.expandByPoint(new Vector2(((corner.x + 1) / 2) * three.size.width, ((1 - corner.y) / 2) * three.size.height));
      }
  return { left: box.min.x, top: box.min.y, right: box.max.x, bottom: box.max.y };
}

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
  const { handling } = probeStats;
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
    crateScreen: projectCrate(three),
    frames,
    pulses: probeStats.pulsesFired,
    photonsActive: probeStats.photonsActive,
    shapedBlocking: !!s.result.design?.shapedBlocking,
    profileMs: lastProfileMs,
    cog: s.result.design
      ? {
          mm: [...s.result.design.centerOfGravityMm],
          marker: handling.cog ? [...handling.cog] : null,
          arrows: handling.arrows,
          arrowsShown: handling.arrowsShown,
          arrowBox: handling.arrowBox ? { ...handling.arrowBox } : null,
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
