import type { Assembly } from "./crate";

/**
 * How each assembly is named for people: cut-list rows, the print, the PDF, the CSV and the
 * 3D model's node names. Belongs next to `ASSEMBLIES` in the domain core; kept in its own file
 * for now so `crate.ts` can be split without a clash.
 */
export const ASSEMBLY_NAMES: Record<Assembly, string> = {
  base: "Base",
  sides: "Side walls",
  ends: "End walls",
  lid: "Lid",
  inside: "Inside the crate",
};
