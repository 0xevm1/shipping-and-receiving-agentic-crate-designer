import type { Vec3 } from "./schema";

/**
 * The frame a part file is read in (spec §4): what its numbers are in, and which axis points up.
 * Pure numbers, so the browser (`src/lib/partFrame.ts`, which also turns the three.js model), the
 * upload API and the CLI (#46) read a file's size the same way. The domain only ever sees mm, Z up.
 */

/** What a loaded model's numbers are in: metres, millimetres or inches. */
export const MODEL_UNITS = ["m", "mm", "in"] as const;
export type ModelUnits = (typeof MODEL_UNITS)[number];
/** Which model axis points up: Z (the crate's own frame, and the sample files') or Y (glTF's own convention). */
export const UP_AXES = ["z", "y"] as const;
export type UpAxis = (typeof UP_AXES)[number];

export const MM_PER_UNIT: Record<ModelUnits, number> = { m: 1000, mm: 1, in: 25.4 };

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

/** The frame a file is first read in when nothing says otherwise: Z up, units guessed from its size. */
export const guessedFrame = (raw: Vec3): PartFrame => ({ units: guessUnits(Math.max(...raw)), up: "z" });

/**
 * A measured size to 0.01 mm. A file keeps float32 digits (a model in inches, or one far from its
 * origin, measures a few thousandths of a mm off), and that noise must not reach the crate.
 */
export const roundSizeMm = (size: Vec3): Vec3 => size.map((v) => Math.round(v * 100) / 100) as Vec3;

/** The size of a model in mm, Z up, from its size as the file has it (file units, file axes). */
export function framedSizeMm(raw: Vec3, { units, up }: PartFrame): Vec3 {
  const k = MM_PER_UNIT[units];
  // A Y-up model turned to stand on Z swaps its two other sides.
  return roundSizeMm(up === "y" ? [raw[0] * k, raw[2] * k, raw[1] * k] : [raw[0] * k, raw[1] * k, raw[2] * k]);
}

/**
 * How a file of size `raw` (file units, file axes) is read: in the units and up axis chosen, each
 * guessed when not given (`guessedFrame`). `guessed` is true when the units are the guess.
 */
export function readFrame(raw: Vec3, chosen: Partial<PartFrame> = {}): { frame: PartFrame; guessed: boolean; sizeMm: Vec3 } {
  const frame: PartFrame = { units: chosen.units ?? guessUnits(Math.max(...raw)), up: chosen.up ?? "z" };
  return { frame, guessed: chosen.units === undefined, sizeMm: framedSizeMm(raw, frame) };
}

/** Sizes this close (mm, per side) are the same size, for finding the frame that gives a known size. */
export const FRAME_MATCH_MM = 0.5;

/**
 * The frame that reads `raw` as `expectedMm` (Z up tried first, then metres, millimetres, inches),
 * or null when none does. For a design saved before the units were recorded, and for a file that
 * has a catalog part's name.
 */
export function fitFrame(raw: Vec3, expectedMm: Vec3): PartFrame | null {
  for (const up of UP_AXES) {
    for (const units of MODEL_UNITS) {
      const size = framedSizeMm(raw, { units, up });
      if (size.every((v, i) => Math.abs(v - expectedMm[i]) < FRAME_MATCH_MM)) return { units, up };
    }
  }
  return null;
}
