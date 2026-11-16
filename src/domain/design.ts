import { getPart } from "./catalog";
import { designCrate, resolveConstruction, structureAllowance, type CrateDesign } from "./crate";
import { enumerateLayouts, type Layout } from "./packing";
import type { CrateSettings, Part } from "./schema";

export interface DesignResult {
  part: Part;
  /** All candidate layouts, best first. */
  layouts: Layout[];
  design: CrateDesign | null;
}

/**
 * Settings → ranked layouts → crate design. Pure and synchronous, so the UI can
 * recompute it on every change with `useMemo`.
 */
export function computeDesign(settings: CrateSettings, layoutKey?: string | null): DesignResult {
  const part = getPart(settings.partId);
  const construction = resolveConstruction(settings, part.mass_kg * settings.quantity);
  const layouts = enumerateLayouts({
    partSize: part.dimensions_mm,
    quantity: settings.quantity,
    keepUpright: settings.keepUpright,
    maxLayers: settings.maxLayers,
    partGapMm: settings.partGapMm,
    wallClearanceMm: settings.wallClearanceMm,
    separatorMm: construction.panelMm,
    structureAllowance: structureAllowance(construction),
  });
  const layout = layouts.find((l) => l.key === layoutKey) ?? layouts[0];
  return { part, layouts, design: layout ? designCrate(part, settings, layout) : null };
}

export const DEFAULT_SETTINGS: CrateSettings = {
  partId: "PART-001",
  quantity: 4,
  keepUpright: true,
  maxLayers: 2,
  partGapMm: 50,
  wallClearanceMm: 50,
  panelThickness: "auto",
};
