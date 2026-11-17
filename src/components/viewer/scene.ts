import { Color, MeshStandardMaterial, Mesh, type Material, type Object3D } from "three";
import type { Member, MemberKind } from "@/domain/crate";
import { partFinish } from "@/domain/partDetails";
import type { Vec3 } from "@/domain/schema";
import type { DesignerState, ViewState } from "@/state/store";
import { anim } from "@/state/motion";

/** Wood colours. Dunnage is darker so it reads apart from the crate. */
export const WOOD: Record<MemberKind, string> = {
  skid: "#9e7345",
  floor: "#ccad7d",
  side: "#dec292",
  end: "#dec292",
  lid: "#e3c999",
  cleat: "#c2915a",
  "lid-cleat": "#c2915a",
  separator: "#ebd6ad",
  bearer: "#85522b",
  blocking: "#85522b",
};
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
 * What is lit up. A pinned row or a cut-list / weight-bar hover "focuses":
 * the lit boards draw solid and everything else ghosts. A 3D hover only tints.
 */
export function highlightOf(s: Pick<DesignerState, "pin" | "hover">) {
  const keys = new Set<string>();
  if (s.pin) keys.add(s.pin);
  if (s.hover?.key) keys.add(s.hover.key);
  return {
    isLit: (m: Member) => keys.has(m.bomKey) || (!!s.hover?.assembly && m.assembly === s.hover.assembly),
    focus: !!s.pin || s.hover?.source === "list",
  };
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

/**
 * Neutral metal for parts, lighter for aluminum (see `partFinish`: text containing "alum"),
 * steel for anything else. Moderate metalness: there is no environment map to reflect.
 */
export function partMaterial(material: string | undefined) {
  const aluminum = partFinish(material) === "aluminum";
  return new MeshStandardMaterial({
    color: aluminum ? "#d4dae1" : "#a7b2be",
    metalness: 0.25,
    roughness: aluminum ? 0.4 : 0.5,
  });
}

/** A copy of a loaded scene with one shared material; geometry buffers stay shared. */
export function cloneWithMaterial(scene: Object3D, material: MeshStandardMaterial): Object3D {
  const copy = scene.clone(true);
  copy.traverse((o) => {
    if (o instanceof Mesh) o.material = material;
  });
  return copy;
}
