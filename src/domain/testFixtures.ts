import { computeDesign, DEFAULT_SETTINGS, type DesignPart } from "./design";
import type { CrateDesign } from "./crate";
import type { CrateSettings } from "./schema";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards, type DeepPartial, type ShopStandards } from "./standards";

/** Shared builders for the domain's unit tests. Not imported by the app. */

/** The standards with a patch applied; throws if the result is not valid. */
export function custom(patch: DeepPartial<ShopStandards>, base: ShopStandards = DEFAULT_STANDARDS): ShopStandards {
  const r = parseStandards(mergeStandards(base, patch));
  if (!r.ok) throw new Error(r.error);
  return r.standards;
}

/** The default settings with a patch applied. */
export const settings = (patch: Partial<CrateSettings> = {}): CrateSettings => ({ ...DEFAULT_SETTINGS, ...patch });

/** The recommended crate for `part` under the patched settings and standards. */
export function designOf(part: DesignPart, patch: Partial<CrateSettings> = {}, standards: ShopStandards = DEFAULT_STANDARDS): CrateDesign {
  return computeDesign(part, settings(patch), null, standards).design!;
}
