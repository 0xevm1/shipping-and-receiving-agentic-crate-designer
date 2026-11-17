import { Group, type Object3D } from "three";
import type { ModelUnits, UpAxis } from "@/domain/designFile";
import type { Vec3 } from "@/domain/schema";

export type { ModelUnits, UpAxis };

/**
 * The frame a part file is read in (spec §4): what its numbers are in, and which axis points up.
 * Both are applied once, here, to the model as the file has it, before anything is measured, so
 * the size, the profile (spec §7.5b), the 3D views and the exported GLB all see the same part:
 * Z up, in model units that `mmPerUnit` turns into millimetres. The domain only ever sees mm, Z up.
 */

export const MM_PER_UNIT: Record<ModelUnits, number> = { m: 1000, mm: 1, in: 25.4 };

/** The choices as the UI words them: "metres", and the sentence "read as inches, Y up". */
export const UNITS_LABEL: Record<ModelUnits, string> = { m: "metres", mm: "millimetres", in: "inches" };
export const UP_LABEL: Record<UpAxis, string> = { z: "Z up", y: "Y up" };

/** The two choices together. */
export interface PartFrame {
  units: ModelUnits;
  up: UpAxis;
}

/**
 * A model up to this many units across is read as metres. Parts bigger than 3 m are rare, and
 * a part that is 4 to 20 units across is far more likely inches than a 4 to 20 m part.
 */
export const METRES_FILE_MAX = 3;
/**
 * A model more than this many units across is read as millimetres: 20 in is a large part, and a
 * 20 m one is a ship. Between the two limits it is read as inches. Only a first guess: sizes
 * overlap (a 60 in part looks like 60 mm), so the UI says it is a guess and lets the user choose.
 */
export const INCHES_FILE_MAX = 20;

/** The units a model is first read in, from its longest side in file units. */
export function guessUnits(longestSide: number): ModelUnits {
  if (longestSide > INCHES_FILE_MAX) return "mm";
  return longestSide > METRES_FILE_MAX ? "in" : "m";
}

/** The size of a model in mm, Z up, from its size as the file has it (file units, file axes). */
export function framedSizeMm(raw: Vec3, { units, up }: PartFrame): Vec3 {
  const k = MM_PER_UNIT[units];
  // A Y-up model turned to stand on Z swaps its two other sides.
  return up === "y" ? [raw[0] * k, raw[2] * k, raw[1] * k] : [raw[0] * k, raw[1] * k, raw[2] * k];
}

/**
 * The model with its up axis turned to Z. Z up is the scene itself (no copy). Y up is a group
 * that turns the model a quarter about X (Y to Z, Z to -Y, a proper rotation, so nothing
 * mirrors) holding a copy that shares the geometry. The shared loader cache is never touched.
 */
export function framedScene(scene: Object3D, up: UpAxis): Object3D {
  if (up === "z") return scene;
  const turned = new Group();
  turned.name = "Y up to Z up";
  turned.rotation.x = Math.PI / 2;
  turned.add(scene.clone(true));
  turned.updateMatrixWorld(true);
  return turned;
}

/** Sizes this close (mm, per side) are the same size, for finding the frame that gives a known size. */
export const FRAME_MATCH_MM = 0.5;

/**
 * The frame that reads `raw` as `expectedMm` (Z up tried first, then metres, millimetres, inches),
 * or null when none does. For a design saved before the units were recorded, and for a file that
 * has a catalog part's name.
 */
export function fitFrame(raw: Vec3, expectedMm: Vec3): PartFrame | null {
  for (const up of ["z", "y"] as const) {
    for (const units of ["m", "mm", "in"] as const) {
      const size = framedSizeMm(raw, { units, up });
      if (size.every((v, i) => Math.abs(v - expectedMm[i]) < FRAME_MATCH_MM)) return { units, up };
    }
  }
  return null;
}

/** "inches, Y up": how a note says what the file was read as. */
export const frameWords = ({ units, up }: PartFrame): string => `${UNITS_LABEL[units]}, ${UP_LABEL[up]}`;
