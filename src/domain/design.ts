import { designCrate, resolveConstruction, structureAllowance, type CrateDesign } from "./crate";
import { enumerateLayouts, type Layout } from "./packing";
import type { CrateSettings, DesignPart } from "./schema";

export type { DesignPart } from "./schema";

export interface DesignResult {
  /** All candidate layouts, best first. */
  layouts: Layout[];
  design: CrateDesign | null;
}

/**
 * Part + settings → ranked layouts → crate design. Pure and synchronous, so the
 * UI can recompute it on every change with `useMemo`.
 */
export function computeDesign(part: DesignPart, settings: CrateSettings, layoutKey?: string | null): DesignResult {
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
  return { layouts, design: layout ? designCrate(part, settings, layout) : null };
}

/** Why the shown layout is the one on screen, for a one-sentence explanation. */
export type LayoutExplanation =
  | { kind: "only" }
  /** Recommended, and the runner-up would tip. */
  | { kind: "stable" }
  /** Recommended, and the runner-up ships `nextMorePct`% more volume. */
  | { kind: "smaller"; nextMorePct: number }
  /** Recommended: the volumes tie, so the lower crate won. */
  | { kind: "tie" }
  /** The user picked a different layout, which ships `morePct`% more than the recommendation. */
  | { kind: "picked"; morePct: number };

export function explainLayout(layouts: Layout[], shown: Layout): LayoutExplanation {
  const [best, next] = layouts;
  if (layouts.length <= 1) return { kind: "only" };
  const pctMore = (l: Layout) => Math.round((l.externalVolumeM3 / best.externalVolumeM3 - 1) * 100);
  if (shown.key !== best.key) return { kind: "picked", morePct: pctMore(shown) };
  if (best.stable && !next.stable) return { kind: "stable" };
  const nextMorePct = pctMore(next);
  return nextMorePct >= 3 ? { kind: "smaller", nextMorePct } : { kind: "tie" };
}

export const DEFAULT_SETTINGS: CrateSettings = {
  quantity: 4,
  keepUpright: true,
  maxLayers: 2,
  partGapMm: 50,
  wallClearanceMm: 50,
  panelThickness: "auto",
};
