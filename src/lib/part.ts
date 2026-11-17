import type { Part, DesignPart, Vec3 } from "@/domain/schema";

/** The part being crated: catalog metadata or a GLB loaded at runtime. */
export interface LoadedPart extends DesignPart {
  modelUrl: string;
  /** The GLB's file name (the catalog `model`, or the loaded file's name); saved in design files. */
  model?: string;
  /** Millimetres per model unit: 1000 for metre files, 1 for files read as millimetres. */
  mmPerUnit: number;
  suggested_quantities: number[];
  /** Catalog size to check the measured model against; absent for unknown files. */
  catalogDims?: Vec3;
  /** No mass came with the file, so a stand-in is in use. */
  massAssumed: boolean;
  /** The file was larger than 20 units across, so it was read as millimetres. */
  readAsMm: boolean;
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
    mmPerUnit: 1000,
    catalogDims: p.dimensions_mm,
    massAssumed: false,
    readAsMm: false,
  };
}
