import { z } from "zod";
import { ANY_FACES, AS_MODELLED_FACES, canonicalFaces, RESTING_FACES } from "./orientations";
import type { PartProfile } from "./profile";

/**
 * Schemas for the part catalog (mirrors `parts.json`) and for the user's crate
 * design inputs. Everything in the domain layer is in millimetres and kilograms,
 * in a right-handed, Z-up frame — the same convention as the source GLBs.
 */

export const Vec3Schema = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);
export type Vec3 = [number, number, number];

/** A bundled catalog part. Exported for the engine's request schema (`DesignPartSchema`, #46). */
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

/**
 * An entry of a parts.json the user supplies (spec §4). Only `id`, `name`, `model` and `mass_kg` are
 * required: a part without a material, density, size or suggested quantities is still a part, and
 * the size then comes from the model. `model_units` is what the model's numbers are in. A bundled
 * `Part` is a `CatalogEntry`. The rules that decide whether a file's entry is accepted live in
 * `src/lib/fileCheck.ts`.
 */
export type CatalogEntry = Pick<Part, "id" | "name" | "model" | "mass_kg"> &
  Partial<Pick<Part, "material" | "density_kg_m3" | "dimensions_mm" | "suggested_quantities">> & {
    model_units?: "m" | "mm" | "in";
  };

export const PartsCatalogSchema = z.object({
  schema_version: z.string(),
  coordinate_system: z.string(),
  model_units: z.literal("meters"),
  metadata_note: z.string().optional(),
  parts: z.array(PartSchema).min(1),
});

/**
 * The minimum a crate design needs to know about a part. Catalog parts satisfy
 * it; so does a GLB loaded at runtime, which has measured dimensions and a
 * user-entered mass but may have no material or density.
 */
export type DesignPart = Pick<Part, "id" | "name" | "mass_kg" | "dimensions_mm"> & {
  material?: string;
  /** The measured outline (spec §7.5b). Absent until the model is analysed: blocking then follows the bounding box. */
  profile?: PartProfile;
};

/** User-editable inputs that drive a crate design. The part itself is passed separately. */
/** The plywood thicknesses the app accepts, in mm (shop standards and the Rules tab stay inside it). */
export const PLYWOOD_MM = { min: 6, max: 50 } as const;

/** The faces of the part's bounding box it may rest on, in the canonical order (`canonicalFaces`), at least one. */
const RestingFacesSchema = z
  .array(z.enum(RESTING_FACES))
  .min(1)
  .refine((faces) => canonicalFaces(faces)?.join() === faces.join(), "list each face once, in the order -z, +z, -y, +y, -x, +x")
  .readonly();

export const CrateSettingsFields = z.object({
  quantity: z.number().int().min(1).max(200),
  /**
   * Which faces of the part (its bounding box in the loaded model's frame) it may rest on; every
   * layout rests it on one of them. `["-z"]` keeps the model as it sits, all six let any face be
   * down. Replaces `keepUpright` (true was `["-z"]`, false all six); see `CrateSettingsSchema`.
   */
  restingFaces: RestingFacesSchema,
  /** Max number of stacked layers (each extra layer adds a plywood separator). */
  maxLayers: z.number().int().min(1).max(6),
  /** Clear space between adjacent parts, filled with wood blocking. */
  partGapMm: z.number().min(0).max(300),
  /** Clear space between parts and the crate walls/floor/lid, filled with blocking. */
  wallClearanceMm: z.number().min(0).max(300),
  /**
   * Plywood panel thickness in mm, or "auto" to choose from payload mass. Any buildable thickness
   * is valid here, so a saved design keeps opening; which ones the shop stocks is checked at the
   * edge (`normalizeSettings`, `panelOptions` in standards.ts).
   */
  panelThickness: z.union([z.literal("auto"), z.number().finite().min(PLYWOOD_MM.min).max(PLYWOOD_MM.max)]),
});
export type CrateSettings = z.infer<typeof CrateSettingsFields>;

/**
 * Settings written before `restingFaces`: `keepUpright: true` is "as modelled" and `false` is
 * "any face". An object with neither (an API caller that leaves the rule out) gets the old default,
 * "as modelled"; one with both keeps `restingFaces`. Faces listed out of order or twice are put
 * in the canonical order, so equal rules hash the same. Anything else is left for the schema to refuse.
 */
export function readSettings(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const { keepUpright, ...rest } = input as Record<string, unknown>;
  let faces: unknown = rest.restingFaces;
  if (faces === undefined) {
    if (keepUpright === undefined || typeof keepUpright === "boolean") faces = keepUpright === false ? ANY_FACES : AS_MODELLED_FACES;
  } else if (Array.isArray(faces)) {
    faces = canonicalFaces(faces) ?? faces;
  }
  return faces === undefined ? rest : { ...rest, restingFaces: faces };
}

/**
 * The settings as read from anywhere they arrive: a design file, a share link, the library, a
 * stored server row, an API call. Old shapes (`keepUpright`) are accepted and read as above.
 */
export const CrateSettingsSchema = z.preprocess(readSettings, CrateSettingsFields);

const NUMERIC_SETTINGS = ["quantity", "maxLayers", "partGapMm", "wallClearanceMm"] as const;

/**
 * The store boundary for settings: merges a patch from the UI onto the current
 * settings so the domain only ever sees values the schema accepts.
 * - Finite numbers are clamped into the schema's range (counts are rounded).
 * - Anything else (NaN, ±Infinity, a wrong type, a panel thickness outside the
 *   plywood range) is rejected field by field: the current value is kept.
 * - With `stocked` (the shop's plywood thicknesses), a panel thickness that is not one of them is
 *   rejected too. Loading a saved design passes none, so old designs open as saved.
 * - Unknown keys are dropped.
 */
export function normalizeSettings(patch: Partial<CrateSettings>, current: CrateSettings, stocked?: readonly number[]): CrateSettings {
  const next: CrateSettings = { ...current };
  const shape = CrateSettingsFields.shape;
  for (const key of NUMERIC_SETTINGS) {
    const v: unknown = patch[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const field = shape[key];
    const n = field.isInt ? Math.round(v) : v;
    next[key] = Math.min(field.maxValue ?? n, Math.max(field.minValue ?? n, n));
  }
  // The faces a part may rest on: a list of known faces, at least one; anything else keeps the current rule.
  const faces = Array.isArray(patch.restingFaces) ? canonicalFaces(patch.restingFaces) : null;
  if (faces) next.restingFaces = faces;
  const panel = patch.panelThickness;
  if (shape.panelThickness.safeParse(panel).success && (stocked === undefined || panel === "auto" || stocked.includes(panel as number))) {
    next.panelThickness = panel!;
  }
  return CrateSettingsFields.parse(next);
}

type NumericSetting = (typeof NUMERIC_SETTINGS)[number];

/** A typed number that `normalizeSettings` did not take as given, so the UI can say why. */
export interface SettingsAdjustment {
  key: NumericSetting;
  /** clamped into range, rounded to a whole number, or rejected (the old value stays). */
  kind: "clamped" | "rounded" | "rejected";
  /** The value the settings now hold. */
  value: number;
  min: number;
  max: number;
}

/**
 * What `normalizeSettings(patch, current)` changes or refuses among the numeric fields
 * present in the patch. Empty when every value was taken as given.
 */
export function settingsAdjustments(patch: Partial<CrateSettings>, current: CrateSettings): SettingsAdjustment[] {
  const next = normalizeSettings(patch, current);
  const shape = CrateSettingsFields.shape;
  const out: SettingsAdjustment[] = [];
  for (const key of NUMERIC_SETTINGS) {
    if (!(key in patch)) continue;
    const v: unknown = patch[key];
    const field = shape[key];
    const range = { min: field.minValue ?? -Infinity, max: field.maxValue ?? Infinity };
    if (typeof v !== "number" || !Number.isFinite(v)) out.push({ key, kind: "rejected", value: next[key], ...range });
    else if (next[key] !== v) {
      const kind = v < range.min || v > range.max ? "clamped" : "rounded";
      out.push({ key, kind, value: next[key], ...range });
    }
  }
  return out;
}
