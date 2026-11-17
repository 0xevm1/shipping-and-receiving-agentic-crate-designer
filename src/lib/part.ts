import type { Part, DesignPart, Vec3 } from "@/domain/schema";
import { clampToBox } from "@/domain/cog";
import { framedSizeMm, MM_PER_UNIT, reframeOffset, type ModelUnits, type PartFrame, type UpAxis } from "./partFrame";

/** The part being crated: catalog metadata or a GLB loaded at runtime. */
export interface LoadedPart extends DesignPart {
  modelUrl: string;
  /** The GLB's file name (the catalog `model`, or the loaded file's name); saved in design files. */
  model?: string;
  /** What the file's numbers are in. Catalog files are metres. Set with `framePart`. */
  modelUnits: ModelUnits;
  /** Which axis of the file points up. Catalog files are Z up. Set with `framePart`. */
  upAxis: UpAxis;
  /** The units are a guess from the model's size, not a choice (the header and the Checks tab say so). */
  unitsGuessed: boolean;
  /** Millimetres per model unit, from `modelUnits` (`MM_PER_UNIT`). */
  mmPerUnit: number;
  /** The model's bounding-box size as the file has it: file units, file axes, before the frame is applied. */
  rawSize: Vec3;
  suggested_quantities: number[];
  /** Catalog size to check the measured model against; absent for unknown files. */
  catalogDims?: Vec3;
  /** No mass came with the file, so a stand-in is in use. */
  massAssumed: boolean;
  // `profile` (from DesignPart) is measured from the model after it renders (`setPartProfile`).
}

/** Where the bundled GLB for a catalog part is served from. The domain's catalog is data only. */
function modelUrl(part: Pick<Part, "model">): string {
  return `/parts/${part.model}`;
}

export function catalogPart(p: Part, url = modelUrl(p)): LoadedPart {
  return {
    id: p.id,
    name: p.name,
    model: p.model,
    material: p.material,
    mass_kg: p.mass_kg,
    dimensions_mm: p.dimensions_mm,
    suggested_quantities: p.suggested_quantities,
    modelUrl: url,
    modelUnits: "m",
    upAxis: "z",
    unitsGuessed: false,
    mmPerUnit: MM_PER_UNIT.m,
    rawSize: p.dimensions_mm.map((v) => v / 1000) as Vec3,
    catalogDims: p.dimensions_mm,
    massAssumed: false,
  };
}

/**
 * The part read in `frame`: its size follows from the file's own size, and the measured outline
 * is dropped because it was taken in the old frame (the viewer measures it again). `guessed` is
 * whether the units are the app's guess.
 */
export function framePart(part: LoadedPart, frame: PartFrame, guessed = false): LoadedPart {
  const rest: LoadedPart = { ...part };
  delete rest.profile;
  delete rest.cog;
  const dimensions_mm = framedSizeMm(part.rawSize, frame);
  // The centre of gravity is a point of the part: the same point (in the file's own numbers) in the new frame (#110).
  const cog = part.cog && {
    ...part.cog,
    offsetMm: clampToBox(reframeOffset(part.cog.offsetMm, { units: part.modelUnits, up: part.upAxis }, frame), dimensions_mm),
  };
  return {
    ...rest,
    ...(cog ? { cog } : {}),
    modelUnits: frame.units,
    upAxis: frame.up,
    unitsGuessed: guessed,
    mmPerUnit: MM_PER_UNIT[frame.units],
    dimensions_mm,
  };
}

/**
 * The units and up axis can be set on a file the user loaded. The three catalog parts come from
 * the app's own files, whose frame is known. The same files dropped from disk are the user's
 * files: they are read in whichever frame gives the catalog size, and the header offers the
 * choice when none does (the model check fails).
 */
export const canSetFrame = (part: Pick<LoadedPart, "modelUrl">): boolean => part.modelUrl.startsWith("blob:");
