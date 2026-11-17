import { z } from "zod";

/**
 * Schemas for the part catalog (mirrors `parts.json`) and for the user's crate
 * design inputs. Everything in the domain layer is in millimetres and kilograms,
 * in a right-handed, Z-up frame — the same convention as the source GLBs.
 */

export const Vec3Schema = z.tuple([
  z.number().positive(),
  z.number().positive(),
  z.number().positive(),
]);
export type Vec3 = [number, number, number];

export const PartSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** GLB filename, served from /public/parts. */
  model: z.string().endsWith(".glb"),
  material: z.string(),
  density_kg_m3: z.number().positive(),
  /** Supplied shipping mass per part. Not derived from mesh volume. */
  mass_kg: z.number().positive(),
  /** Axis-aligned bounding box of the mesh in the model's own frame, [x, y, z]. */
  dimensions_mm: Vec3Schema,
  suggested_quantities: z.array(z.number().int().positive()).min(1),
});
export type Part = z.infer<typeof PartSchema>;

export const PartsCatalogSchema = z.object({
  schema_version: z.string(),
  coordinate_system: z.string(),
  model_units: z.literal("meters"),
  metadata_note: z.string().optional(),
  parts: z.array(PartSchema).min(1),
});
export type PartsCatalog = z.infer<typeof PartsCatalogSchema>;

/**
 * The minimum a crate design needs to know about a part. Catalog parts satisfy
 * it; so does a GLB loaded at runtime, which has measured dimensions and a
 * user-entered mass but may have no material or density.
 */
export type DesignPart = Pick<Part, "id" | "name" | "mass_kg" | "dimensions_mm"> & {
  material?: string;
};

/** User-editable inputs that drive a crate design. The part itself is passed separately. */
export const CrateSettingsSchema = z.object({
  quantity: z.number().int().min(1).max(200),
  /** Restrict to rotations about Z, so the part's modeled "up" stays up. */
  keepUpright: z.boolean(),
  /** Max number of stacked layers (each extra layer adds a plywood separator). */
  maxLayers: z.number().int().min(1).max(6),
  /** Clear space between adjacent parts, filled with wood blocking. */
  partGapMm: z.number().min(0).max(300),
  /** Clear space between parts and the crate walls/floor/lid, filled with blocking. */
  wallClearanceMm: z.number().min(0).max(300),
  /** Plywood panel thickness, or "auto" to choose from payload mass. */
  panelThickness: z.union([z.literal("auto"), z.literal(12), z.literal(15), z.literal(19)]),
});
export type CrateSettings = z.infer<typeof CrateSettingsSchema>;
