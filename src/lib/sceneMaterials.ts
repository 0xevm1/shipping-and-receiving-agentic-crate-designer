import { Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { MemberKind } from "@/domain/crate";
import { partFinish } from "@/domain/partDetails";

/**
 * Colours and materials the live viewer and the GLB export share, so the downloaded crate
 * looks like the one on screen. No React, no store.
 */

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
  joist: "#a87a48",
  cradle: "#7a4a26",
};

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
