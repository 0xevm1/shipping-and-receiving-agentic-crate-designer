import { Color, type Material, type Vector3 } from "three";
import type { CrateDesign, Member } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import type { DesignerState, ViewState } from "@/state/store";
import { anim } from "@/state/motion";

/**
 * The scene's units and shared numbers. The domain is Z-up millimetres; three.js is Y-up metres.
 * `CrateViewer`'s root group applies `MM_TO_M` and the Z-up to Y-up turn to everything drawn in
 * domain coordinates. Code that works in world space outside that group (camera framing, the
 * floor, the part turntable) converts with these, so the rule lives in one place.
 */
export const MM_TO_M = 0.001;
/** Domain point (mm, Z up) to world metres (Y up), as the root group places it. Returns `out`. */
export function domainToWorld(p: Vec3, out: Vector3): Vector3 {
  return out.set(p[0], p[2], -p[1]).multiplyScalar(MM_TO_M);
}
/** Vertical field of view of both canvases, degrees. */
export const FOV_DEG = 34;
/** Pointer travel (px) that turns a click into an orbit drag. */
export const CLICK_SLOP_PX = 5;
/** Far clipping plane in m (the canvas default); `Director` pushes it out for very large crates. */
export const CAMERA_FAR_M = 200;

// Shared with the GLB export, so they live in `src/lib`.
export { cloneWithMaterial, partMaterial, WOOD } from "@/lib/sceneMaterials";

export const EDGE = new Color("#291a0a");
/** Selection: Hadrian sky blue. */
export const ICE = new Color("#70b8fd");
export const ICE_EDGE = new Color("#e3f1ff");
export const GHOST_EDGE = new Color("#d9ccb3");

/** How far each face moves when fully exploded, in mm. */
export const EXPLODE_WALL_MM = 320;
export const EXPLODE_LID_MM = 420;
/** Opacity of everything outside the focused group. */
export const GHOST_BOARD = 0.07;
export const GHOST_PART = 0.1;

/**
 * Where the crate-interior frame sits in the scene (domain mm, Z up): the footprint centred on
 * the origin, with the bottom of the skids on the ground.
 */
export function sceneOrigin(design: CrateDesign): Vec3 {
  const [L, W] = design.layout.interior;
  return [-L / 2, -W / 2, design.construction.baseMm];
}

export function explodeOffset(face: Member["face"], e: number): Vec3 {
  switch (face) {
    case "side-":
      return [0, -EXPLODE_WALL_MM * e, 0];
    case "side+":
      return [0, EXPLODE_WALL_MM * e, 0];
    case "end-":
      return [-EXPLODE_WALL_MM * e, 0, 0];
    case "end+":
      return [EXPLODE_WALL_MM * e, 0, 0];
    case "lid":
      return [0, 0, EXPLODE_LID_MM * e];
    default:
      return [0, 0, 0];
  }
}

/** Opacity from the view: the lid and front wall fade with the mode; dunnage follows the Blocking switch. */
export function memberAlpha(m: Member, view: ViewState): number {
  if (m.face === "lid") return anim.lidAlpha;
  if (m.face === "side-") return anim.frontAlpha;
  if (m.assembly === "inside") return view.blocking ? 1 : 0;
  return 1;
}

/**
 * Whether a board is lit: its row is pinned or hovered, or its whole assembly is hovered from
 * the weight bars. Allocation-free, as it runs for every board each frame.
 */
export function isLit(s: Pick<DesignerState, "pin" | "hover">, m: Member): boolean {
  const { pin, hover } = s;
  return pin === m.bomKey || hover?.key === m.bomKey || (!!hover?.assembly && m.assembly === hover.assembly);
}

/**
 * Whether the scene is "focused": a pinned row or a cut-list / weight-bar hover draws the lit
 * boards solid and ghosts everything else. A 3D hover only tints.
 */
export function hasFocus(s: Pick<DesignerState, "pin" | "hover">): boolean {
  return !!s.pin || s.hover?.source === "list";
}

/**
 * Set a material's opacity, switching it between the opaque and transparent
 * passes. Flipping `transparent` changes the compiled shader (three adds an
 * OPAQUE define that forces alpha to 1), so it needs a recompile — three caches
 * both variants, so this is cheap after the first time.
 */
export function setOpacity(m: Material, opacity: number) {
  const transparent = opacity < 0.99;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
  m.opacity = opacity;
  m.depthWrite = !transparent;
}
