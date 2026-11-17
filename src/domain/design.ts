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
  ranking: Ranking = "volume",
): DesignResult {
  const problem = inputProblem(part, settings, standards);
  if (problem) return { layouts: [], design: null, problem };

  const ranked = rankByObjective(part, settings, rankLayouts(part, settings, standards), ranking, standards);
  const layouts = ranked.layouts;
  const layout = layouts.find((l) => l.key === layoutKey) ?? layouts[0];
  // Unreachable for valid input (spec §7.2), but never leave the screen blank.
  if (!layout) return { layouts, design: null, problem: NO_LAYOUT };
  return { layouts, design: ranked.designs.get(layout.key) ?? designCrate(part, settings, layout, standards), problem: null };
}

/**
 * How the recommended layout is chosen (#17, spec §7.2). `volume` is the default ranking
 * (stable, then least outside volume, then lowest). `cost` and `density` re-rank by total
 * crate cost (lowest first) or by freight (lowest estimated freight class, then lightest gross).
 */
export const RANKINGS = ["volume", "cost", "density"] as const;
export type Ranking = (typeof RANKINGS)[number];

/**
 * Re-ranks `layouts` (already in the default order) by `ranking`, designing each crate to
 * cost it. Hard constraints come first and are never traded for cost or density: `fits`
 * (shipment planning's per-crate limits, when given), then stable, then every part blocked
 * in (the `blocking` check passes); for `density`, also no LTL excessive-length charge (the
 * `oversize` check), so a long single row can't win on class alone. Within a freight class the
 * lighter crate wins, since LTL charges by class and weight. Ties keep the default order. With `volume` the layouts
 * are returned as they are and nothing is designed. `designs` holds the crates it designed,
 * by layout key, so the caller can reuse the winner's.
 */
export function rankByObjective(
  part: DesignPart,
  settings: CrateSettings,
  layouts: Layout[],
  ranking: Ranking,
  standards: ShopStandards = DEFAULT_STANDARDS,
  fits?: (d: CrateDesign) => boolean,
): { layouts: Layout[]; designs: Map<string, CrateDesign> } {
  const designs = new Map<string, CrateDesign>();
  if (ranking === "volume" || layouts.length < 2) return { layouts, designs };
  const scored = layouts.map((layout, index) => {
    const d = designCrate(part, settings, layout, standards);
    designs.set(layout.key, d);
    const blocked = d.checks.find((c) => c.id === "blocking")?.level !== "caution";
    const surcharge = ranking === "density" && d.checks.some((c) => c.id === "oversize");
    return { layout, index, d, hard: [fits && !fits(d) ? 1 : 0, layout.stable ? 0 : 1, blocked ? 0 : 1, surcharge ? 1 : 0] };
  });
  // Whole cents and whole lb: smaller differences are rounding, not a better crate.
  const objective = (d: CrateDesign) =>
    ranking === "cost" ? [Math.round(d.cost.totalUsd * 100)] : [d.freightClass, Math.round(d.freight.grossLb)];
  scored.sort((x, y) => {
    for (let i = 0; i < x.hard.length; i++) if (x.hard[i] !== y.hard[i]) return x.hard[i] - y.hard[i];
    const [ox, oy] = [objective(x.d), objective(y.d)];
    for (let i = 0; i < ox.length; i++) if (ox[i] !== oy[i]) return ox[i] - oy[i];
    return x.index - y.index;
  });
  return { layouts: scored.map((s) => s.layout), designs };
}

/** The scorecard numbers for one layout of the batch, for comparing layouts (#17). */
export interface LayoutScore {
  costUsd: number;
  labourHours: number;
  freightClass: number;
  densityLbFt3: number;
}

/** Scores each layout by designing its crate. For the few cards on screen, not the whole list. */
export function scoreLayouts(
  part: DesignPart,
  settings: CrateSettings,
  layouts: readonly Layout[],
  standards: ShopStandards = DEFAULT_STANDARDS,
): Map<string, LayoutScore> {
  const out = new Map<string, LayoutScore>();
  for (const l of layouts) {
    if (out.has(l.key)) continue;
    const d = designCrate(part, settings, l, standards);
    out.set(l.key, { costUsd: d.cost.totalUsd, labourHours: d.labour.hours, freightClass: d.freightClass, densityLbFt3: d.densityLbFt3 });
  }
  return out;
}

/**
 * Every layout for the batch, best first (spec §7.2), without designing a crate. For input
 * `computeDesign` accepts; used by shipment planning to compare crate sizes cheaply.
 */
export function rankLayouts(part: DesignPart, settings: CrateSettings, standards: ShopStandards = DEFAULT_STANDARDS): Layout[] {
  const construction = resolveConstruction(settings, part.mass_kg * settings.quantity, standards);
  return enumerateLayouts(
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
  | { kind: "picked"; morePct: number }
  /** Recommended under a cost or freight-density ranking (#17). */
  | { kind: "ranked"; by: Exclude<Ranking, "volume"> };

export function explainLayout(
  layouts: Layout[],
  shown: Layout,
  standards: ShopStandards = DEFAULT_STANDARDS,
  ranking: Ranking = "volume",
): LayoutExplanation {
  const [best, next] = layouts;
  if (layouts.length <= 1) return { kind: "only" };
  const pctMore = (l: Layout) => Math.round((l.externalVolumeM3 / best.externalVolumeM3 - 1) * 100);
  if (shown.key !== best.key) return { kind: "picked", morePct: pctMore(shown) };
  if (ranking !== "volume") return { kind: "ranked", by: ranking };
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
