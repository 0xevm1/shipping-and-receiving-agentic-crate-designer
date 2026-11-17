import rawCatalog from "@/data/parts.json";
import { PartsCatalogSchema, type Part } from "./schema";

/** Validated at module load so bad catalog data fails loudly, not mid-render. */
export const catalog = PartsCatalogSchema.parse(rawCatalog);

export const parts: Part[] = catalog.parts;

export function getPart(id: string): Part {
  const part = parts.find((p) => p.id === id);
  if (!part) throw new Error(`Unknown part id: ${id}`);
  return part;
}
