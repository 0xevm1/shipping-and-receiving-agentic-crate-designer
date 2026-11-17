import { designCrate, resolveConstruction, structureAllowance, type CrateDesign } from "./crate";
import { enumerateLayouts, type Layout } from "./packing";
import { CrateSettingsSchema, type CrateSettings, type DesignPart } from "./schema";
import { DEFAULT_STANDARDS, minInteriorMm, ShopStandardsSchema, type ShopStandards } from "./standards";

export type { DesignPart } from "./schema";

/**
 * Longest part side accepted, in mm. Anything longer is almost always a file
 * exported in the wrong units, and would make a crate too big to draw.
 */
export const MAX_PART_MM = 20000;

/** Why there is no crate to show. The domain owns the wording, as it does for checks. */
export interface DesignProblem {
  id: "part-size" | "part-too-large" | "part-mass" | "settings" | "standards" | "no-layout";
  title: string;
  detail: string;
}

export interface DesignResult {
  /** All candidate layouts, best first. Empty when there is a problem. */
  layouts: Layout[];
  design: CrateDesign | null;
  /** Set exactly when `design` is null. */
  problem: DesignProblem | null;
}

/**
 * Part + settings → ranked layouts → crate design. Pure and synchronous, so the
 * UI can recompute it on every change with `useMemo`. Never throws: input it
 * can't design for comes back as a `problem` instead of a design.
 *
 * `standards` are the shop's house rules (stock, thresholds, limits, rates); the
 * defaults reproduce every design from before they were configurable.
 */
export function computeDesign(
  part: DesignPart,
  settings: CrateSettings,
  layoutKey?: string | null,
  standards: ShopStandards = DEFAULT_STANDARDS,
): DesignResult {
  const problem = inputProblem(part, settings, standards);
  if (problem) return { layouts: [], design: null, problem };

  const construction = resolveConstruction(settings, part.mass_kg * settings.quantity, standards);
  const layouts = enumerateLayouts(
    {
    partSize: part.dimensions_mm,
    quantity: settings.quantity,
    keepUpright: settings.keepUpright,
    maxLayers: settings.maxLayers,
    partGapMm: settings.partGapMm,
    wallClearanceMm: settings.wallClearanceMm,
    separatorMm: construction.panelMm,
    structureAllowance: structureAllowance(construction),
    minInteriorMm: minInteriorMm(standards),
    },
    standards,
  );
  const layout = layouts.find((l) => l.key === layoutKey) ?? layouts[0];
  // Unreachable for valid input (spec §7.2), but never leave the screen blank.
  if (!layout) return { layouts, design: null, problem: NO_LAYOUT };
  return { layouts, design: designCrate(part, settings, layout, standards), problem: null };
}

const NO_LAYOUT: DesignProblem = {
  id: "no-layout",
  title: "No layout fits these packing rules",
  detail: "Try more layers, smaller gaps or turning off Keep parts upright.",
};

/** The first reason the part or settings can't be designed for, or null when they can. */
function inputProblem(part: DesignPart, settings: CrateSettings, standards: ShopStandards): DesignProblem | null {
  const dims = part.dimensions_mm;
  if (!Array.isArray(dims) || dims.length !== 3 || !dims.every((v) => Number.isFinite(v) && v > 0)) {
    return {
      id: "part-size",
      title: "The part has no usable size",
      detail: "Every side must be longer than zero. Check that the model has solid geometry on all three axes.",
    };
  }
  const longest = Math.max(...dims);
  if (longest > MAX_PART_MM) {
    return {
      id: "part-too-large",
      title: `The part is over ${MAX_PART_MM / 1000} m long`,
      detail: `Its longest side is ${Math.round(longest)} mm. Check the file's units: parts over ${MAX_PART_MM / 1000} m are not crated here.`,
    };
  }
  if (!Number.isFinite(part.mass_kg) || part.mass_kg <= 0) {
    return { id: "part-mass", title: "The part needs a mass", detail: "Enter a mass above zero for one part." };
  }
  const parsed = CrateSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      id: "settings",
      title: "A packing rule is out of range",
      detail: `${issue.path.join(".") || "Settings"}: ${issue.message}. Reset the rules to continue.`,
    };
  }
  // Skip the parse for the shipped defaults: they are checked by a test, and this runs on every keystroke.
  if (standards !== DEFAULT_STANDARDS) {
    const std = ShopStandardsSchema.safeParse(standards);
    if (!std.success) {
      const issue = std.error.issues[0];
      return {
        id: "standards",
        title: "A shop standard is out of range",
        detail: `${issue.path.join(".") || "Standards"}: ${issue.message}. Reset the shop standards to continue.`,
      };
    }
  }
  return null;
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

export function explainLayout(
  layouts: Layout[],
  shown: Layout,
  standards: ShopStandards = DEFAULT_STANDARDS,
): LayoutExplanation {
  const [best, next] = layouts;
  if (layouts.length <= 1) return { kind: "only" };
  const pctMore = (l: Layout) => Math.round((l.externalVolumeM3 / best.externalVolumeM3 - 1) * 100);
  if (shown.key !== best.key) return { kind: "picked", morePct: pctMore(shown) };
  if (best.stable && !next.stable) return { kind: "stable" };
  const nextMorePct = pctMore(next);
  // Rounded, because 0.03 × 100 is 3.0000000000000004 in floating point.
  const tiePct = Math.round(standards.defaults.volumeTolerance * 1e4) / 100;
  return nextMorePct >= tiePct ? { kind: "smaller", nextMorePct } : { kind: "tie" };
}

/** A new crate's settings under the given standards (gap, clearance and layers come from `defaults`). */
export function settingsFromStandards(standards: ShopStandards, quantity = 4): CrateSettings {
  const { partGapMm, wallClearanceMm, maxLayers } = standards.defaults;
  return { quantity, keepUpright: true, maxLayers, partGapMm, wallClearanceMm, panelThickness: "auto" };
}

export const DEFAULT_SETTINGS: CrateSettings = settingsFromStandards(DEFAULT_STANDARDS);
