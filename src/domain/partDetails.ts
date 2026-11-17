import { z } from "zod";

/**
 * Details the user enters for a part that is not in the catalog (spec §6.2a).
 * Mass is always typed in by the user; it is never inferred from the mesh.
 */

export const PART_NAME_MAX = 80;
export const PART_MATERIAL_MAX = 60;

/** Offered in the material field; any other text is accepted too. */
export const MATERIAL_SUGGESTIONS = ["6061-T6 aluminum", "4140 steel", "304 stainless steel"] as const;

/** Trim, drop control characters and collapse runs of whitespace. */
const tidy = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A partial update. `material: ""` (or blank) clears the material, so the UI
 * shows "material not given". A key that is absent leaves that field alone.
 */
const PartDetailsSchema = z.object({
  name: z
    .string()
    .transform(tidy)
    .pipe(z.string().min(1, "Enter a part name.").max(PART_NAME_MAX, `Keep the name under ${PART_NAME_MAX} characters.`))
    .optional(),
  material: z
    .string()
    .transform(tidy)
    .pipe(z.string().max(PART_MATERIAL_MAX, `Keep the material under ${PART_MATERIAL_MAX} characters.`))
    .optional(),
  mass_kg: z.number().positive("Mass must be more than 0 kg.").optional(),
});
export type PartDetailsInput = z.input<typeof PartDetailsSchema>;

interface PartDetails {
  name?: string;
  /** `undefined` here (with the key present) means the material was cleared. */
  material?: string | undefined;
  mass_kg?: number;
}

type PartDetailsResult = { ok: true; details: PartDetails } | { ok: false; error: string };

/** Validates and tidies a partial update to an unknown part's name, material and mass. */
export function cleanPartDetails(input: PartDetailsInput): PartDetailsResult {
  const r = PartDetailsSchema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Invalid part details." };
  const details: PartDetails = {};
  if (r.data.name !== undefined) details.name = r.data.name;
  if (r.data.material !== undefined) details.material = r.data.material || undefined;
  if (r.data.mass_kg !== undefined) details.mass_kg = r.data.mass_kg;
  return { ok: true, details };
}

/**
 * How a part is drawn. Any material text containing "alum" gets the lighter
 * aluminum look; everything else (steels, iron, unknown, not given) looks like steel.
 */
type PartFinish = "aluminum" | "steel";
export function partFinish(material: string | undefined): PartFinish {
  return /alum/i.test(material ?? "") ? "aluminum" : "steel";
}
