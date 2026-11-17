import { Group, type Object3D } from "three";
import type { ModelUnits, PartFrame, UpAxis } from "@/domain/partFrame";

/**
 * The frame a part file is read in (spec §4): what its numbers are in, and which axis points up.
 * Both are applied once to the model as the file has it, before anything is measured, so the size,
 * the profile (spec §7.5b), the 3D views and the exported GLB all see the same part: Z up, in model
 * units that `mmPerUnit` turns into millimetres. The numbers (units, the guess, the framed size)
 * are the domain's (`@/domain/partFrame`), shared with the upload API; this adds the three.js turn
 * and the words the UI uses.
 */
export {
  FRAME_MATCH_MM,
  fitFrame,
  framedSizeMm,
  guessedFrame,
  guessUnits,
  cogFromFile,
  reframeOffset,
  INCHES_FILE_MAX,
  METRES_FILE_MAX,
  MM_PER_UNIT,
  roundSizeMm,
  type ModelUnits,
  type PartFrame,
  type UpAxis,
} from "@/domain/partFrame";

/** The choices as the UI words them: "metres", and the sentence "read as inches, Y up". */
export const UNITS_LABEL: Record<ModelUnits, string> = { m: "metres", mm: "millimetres", in: "inches" };
export const UP_LABEL: Record<UpAxis, string> = { z: "Z up", y: "Y up" };

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

/** "inches, Y up": how a note says what the file was read as. */
export const frameWords = ({ units, up }: PartFrame): string => `${UNITS_LABEL[units]}, ${UP_LABEL[up]}`;
