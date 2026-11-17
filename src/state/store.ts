import { create } from "zustand";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS, settingsFromStandards, type DesignResult, type Ranking } from "@/domain/design";
import { cleanPartDetails, type PartDetailsInput } from "@/domain/partDetails";
import type { PartProfile } from "@/domain/profile";
import type { ShipmentPlan } from "@/domain/shipment";
import type { QuantitySweep } from "@/domain/sweep";
import { normalizeSettings, type CatalogEntry, type CrateSettings, type Vec3 } from "@/domain/schema";
import { DEFAULT_STANDARDS, mergeStandards, panelOptions, parseStandards, type DeepPartial, type ShopStandards } from "@/domain/standards";
import { designRequestFor } from "@/engine/request";
import type { DesignResponse, EngineStamp } from "@/engine/schemas";
import { canSetFrame, catalogPart, framePart, type LoadedPart } from "@/lib/part";
import { models } from "@/lib/modelRegistry";
import type { PartFrame } from "@/lib/partFrame";
import { emitDesignEdit, type ChangeSource, type DesignEdit } from "./designEvents";
import { engine } from "./engineClient";
import { loadStandards, saveStandards } from "./standardsStorage";

/**
 * A newly loaded part waiting to open at the quantity sweep's recommendation (spec §7.16).
 * `applied` is false until the first sweep result has been applied; it then waits for the
 * model's outline (shaped blocking), which can move the recommendation, and applies it once more.
 */
export interface AutoRecommend {
  /** The part it is for: its model. */
  modelUrl: string;
  /** The first result has been applied; waiting for the measured outline's result. */
  applied: boolean;
}

export interface DesignerState {
  part: LoadedPart;
  /** Bounding box measured from the loaded model, in mm. */
  measured: Vec3 | null;
  settings: CrateSettings;
  layoutKey: string | null;
  /** How the batch ships: one crate, or crate types with counts when it is split. */
  plan: ShipmentPlan;
  /** The crate type on screen (index into `plan.crates`); 3D, Layouts, Cut list and Checks follow it. */
  crateIndex: number;
  /** The shown crate type's layouts and design: `plan.crates[crateIndex].result`. */
  result: DesignResult;
  /**
   * The inputs `plan` was designed from, with the engine's stamp (spec §5.1). The same as the
   * store's own inputs, except for the few milliseconds an edit's design spends in the engine's
   * Web Worker: an edit shows in its control at once, and the design follows.
   */
  designedFrom: Designed;
  /** Extra catalog entries from a dropped parts.json. */
  extraParts: CatalogEntry[];
  /** The shop's house rules every design is built to. Saved in localStorage. */
  standards: ShopStandards;

  /** How the recommended layout is chosen: `volume` (the default), `cost` or `density`. Kept across edits. */
  ranking: Ranking;
  /**
   * Set when a new part is loaded (`setPart`), so the part opens at the sweep's recommended
   * quantity and layout (`applyRecommendation`). Cleared by any edit to the design's inputs and
   * by opening a design, which keeps its own settings. Null otherwise.
   */
  autoRecommend: AutoRecommend | null;
  /**
   * The part's rules are still the ones it was loaded with or the recommendation applied to it: true
   * from `setPart` until the person edits the design's inputs (or opens a design). A change of the
   * file's units or up axis (`setPartFrame`) then waits for the recommendation for the new size
   * again, even after the first one has settled.
   */
  onRecommendation: boolean;

  /** Loads a new part: its first suggested quantity until the sweep's recommendation arrives (`autoRecommend`). */
  setPart: (part: LoadedPart) => void;
  /**
   * Applies a sweep result (spec §7.16) for `part` when it is the newly loaded part still
   * waiting for one (`autoRecommend`): sets the recommended quantity and layout, with a change
   * note, the first time, and once more when the result is for the part's measured outline.
   * Anything else (another part, an edit since, a settled part) is ignored.
   */
  applyRecommendation: (part: LoadedPart, sweep: QuantitySweep) => void;
  /** Opens a saved design: the part with its own settings and layout (null = recommended). */
  loadDesign: (part: LoadedPart, settings: CrateSettings, layoutKey: string | null, crateIndex?: number) => void;
  /**
   * Reopens the last-opened crate after a reload: like `loadDesign`, plus its ranking (the tab is view state: the loader sets it).
   * Not the same thing as `restoreDesign` in `@/domain/designFile`, which rebuilds a part's
   * settings from a design file; the loader runs that first and hands its result to this action.
   */
  restoreDesign: (part: LoadedPart, settings: CrateSettings, layoutKey: string | null, crateIndex: number, ranking: Ranking) => void;
  /** Shows another crate type of a split batch. Out-of-range indexes are ignored. */
  setCrateIndex: (index: number) => void;
  setMeasured: (size: Vec3) => void;
  /**
   * Shapes blocking to the part: stores the profile measured from the model at `modelUrl`
   * and re-designs, keeping the layout pick and the camera. Ignored if another model has been
   * loaded since, or the part already has a profile. Null (analysis failed) changes nothing.
   */
  setPartProfile: (modelUrl: string, profile: PartProfile | null) => void;
  /**
   * Name, material and mass for a part loaded without catalog data. Validated;
   * returns an error message (and changes nothing) if the input is invalid or the
   * part is a catalog part, which is read-only.
   */
  setPartDetails: (details: PartDetailsInput) => string | null;
  /**
   * Re-reads the loaded file with another unit and/or up axis (spec §4): the size follows from the
   * file's own measurements, the outline is dropped (the viewer measures it again) and the crate
   * is re-planned. Null on success; an error for a catalog part's bundled file.
   */
  setPartFrame: (frame: Partial<PartFrame>) => string | null;
  setSettings: (patch: Partial<CrateSettings>) => void;
  resetRules: () => void;
  setLayoutKey: (key: string | null) => void;
  /**
   * Deep-merges a patch onto the shop standards, validates the result and re-designs.
   * Returns an error message (and changes nothing) if the result is invalid. Changing a
   * default gap, clearance or layer count also applies it to the current rules.
   */
  setStandards: (patch: DeepPartial<ShopStandards>) => string | null;
  /** Back to the shipped standards (and their default rules). */
  resetStandards: () => void;
  /** Reads the standards saved in this browser. Called once after the app mounts. */
  loadSavedStandards: () => void;
  addCatalogParts: (parts: CatalogEntry[]) => void;
  /** Re-ranks the layouts by volume, crate cost or freight; resets the layout pick. */
  setRanking: (ranking: Ranking) => void;
  /**
   * Marks the part on screen as waiting for its recommendation (`autoRecommend`), as `setPart`
   * does for a new part: the preloaded default part, when startup finds nothing to restore
   * (spec §7.16 "Recommended on load"). Called once, before anything can be edited. Its rules
   * then count as the recommendation's (`onRecommendation`), so a units or up-axis change re-recommends.
   */
  recommendOnStartup: () => void;
}

const DEFAULT_PART_ID = "PART-001";

const initialPart = catalogPart(catalog.parts.find((p) => p.id === DEFAULT_PART_ID)!);

type Planned = Pick<DesignerState, "plan" | "crateIndex" | "result">;

/** What the engine designs from (spec §5.1): its request, with the part as loaded. */
type PlanInput = Pick<DesignerState, "part" | "settings" | "layoutKey" | "standards" | "ranking">;
export type Designed = PlanInput & EngineStamp;

const planInput = ({ part, settings, layoutKey, standards, ranking }: PlanInput): PlanInput => ({ part, settings, layoutKey, standards, ranking });
const designed = (input: PlanInput, { engineVersion, inputHash }: DesignResponse): Designed => ({ ...input, engineVersion, inputHash });

/** Shows a plan: the crate type at `crateIndex` while the plan still has it, else the first. */
function place(plan: ShipmentPlan, crateIndex: number): Planned {
  const i = crateIndex < plan.crates.length ? crateIndex : 0;
  return { plan, crateIndex: i, result: plan.crates[i].result };
}

/** The preloaded part's plan: one crate at the default quantity, designed in this thread. */
function initialPlan(): Planned & Pick<DesignerState, "designedFrom"> {
  const input: PlanInput = { part: initialPart, settings: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS, layoutKey: null, ranking: "volume" };
  const out = engine.designSync(designRequestFor(input));
  return { ...place(out.plan, 0), designedFrom: designed(input, out) };
}

/** What an edit by the person (or opening a design) does to the recommendation on load: stops it for this part. */
const EDITED = { autoRecommend: null, onRecommendation: false } as const;

/** How an action put a design on screen: a part or saved design opened (`designEvents.ts`). */
type Opened = "loaded" | "restored";

/**
 * Edits whose design is still in the engine's worker, oldest first. Always empty where the
 * engine runs in this thread (tests, server rendering): there the design lands before
 * `redesign` returns, in the same `set` as the edit, exactly as a direct call would.
 */
let waiting: { ticket: number; patch: Partial<DesignerState>; opened?: Opened }[] = [];
let tickets = 0;
/** Callbacks for when no design is on its way (`whenDesigned`). */
let onSettled: (() => void)[] = [];

/**
 * Runs `fn` once every design asked for so far is on screen: now when none is in the engine's
 * worker. The startup uses it to hold the scene until a reopened crate's design has landed.
 */
export function whenDesigned(fn: () => void): void {
  if (waiting.length) onSettled.push(fn);
  else fn();
}

export const useDesigner = create<DesignerState>()((set, get) => {
  /**
   * Applies an edit and designs for it (spec §5.1), then tells the view what happened
   * (`designEvents.ts`). With the worker, the edit is stored at once (its control never lags) and
   * its design lands when the engine answers; a newer edit's design supersedes an older one still
   * on its way. What waits for the design: the plan, the crate type shown (`patch.crateIndex` may
   * only exist in the new plan) and the view's event. `edit` names it from the shown crate's
   * result before and after and every edit that lands with it (`merged`); when one of those
   * opened a part or design (`opened`), the view hears that instead, since it resets everything.
   */
  const redesign = (
    patch: Partial<DesignerState>,
    edit: (prev: DesignResult, next: DesignResult, merged: Partial<DesignerState>) => DesignEdit | null,
    opened?: Opened,
  ) => {
    const ticket = ++tickets;
    const now = { ...patch };
    delete now.crateIndex;
    waiting.push({ ticket, patch, ...(opened ? { opened } : {}) });
    const input = planInput({ ...get(), ...now });
    let inline = true;
    engine.design(designRequestFor(input), (out) => {
      const landed = waiting.filter((w) => w.ticket <= ticket);
      waiting = waiting.filter((w) => w.ticket > ticket);
      const merged: Partial<DesignerState> = Object.assign({}, ...landed.map((w) => w.patch));
      const openedBy = landed.findLast((w) => w.opened)?.opened;
      const prev = get().result;
      const crateIndex = "crateIndex" in merged ? merged.crateIndex! : get().crateIndex;
      const planned = place(out.plan, crateIndex);
      set({ ...(inline ? now : {}), ...planned, designedFrom: designed(input, out) });
      const e = openedBy ? ({ type: "opened", restored: openedBy === "restored", prev, next: planned.result } as const) : edit(prev, planned.result, merged);
      if (e) emitDesignEdit(e);
      if (!waiting.length && onSettled.length) {
        const settled = onSettled;
        onSettled = [];
        settled.forEach((fn) => fn());
      }
    });
    inline = false;
    if (waiting.some((w) => w.ticket === ticket)) set(now);
  };

  /**
   * Recompute the design after any input change. `source` is the input behind a change note
   * (`note`: what the note says instead of the diff's summary); `opened` says a part or saved
   * design was put on screen rather than edited.
   */
  const recompute = (patch: Partial<DesignerState>, source?: ChangeSource, opened?: Opened, note?: string) =>
    redesign(
      patch,
      (prev, next, merged) => ({ type: "edited", source: source ?? null, partReplaced: Boolean(merged.part), prev, next, ...(note ? { note } : {}) }),
      opened,
    );

  /** Switches to new standards: carries changed defaults into the rules, re-designs and saves. */
  const applyStandards = (standards: ShopStandards, save = true) => {
    const { settings, standards: old } = get();
    const next = { ...settings };
    for (const key of ["partGapMm", "wallClearanceMm", "maxLayers"] as const) {
      if (standards.defaults[key] !== old.defaults[key]) next[key] = standards.defaults[key];
    }
    // A panel thickness the new stock no longer includes goes back to auto rather than lingering unselectable.
    if (next.panelThickness !== "auto" && !panelOptions(standards).includes(next.panelThickness)) next.panelThickness = "auto";
    recompute({ standards, settings: normalizeSettings(next, settings), layoutKey: null, ...EDITED });
    if (save) saveStandards(standards);
  };

  return {
    part: initialPart,
    measured: null,
    settings: DEFAULT_SETTINGS,
    layoutKey: null,
    ...initialPlan(),
    extraParts: [],
    standards: DEFAULT_STANDARDS,

    ranking: "volume",
    autoRecommend: null,
    onRecommendation: false,

    setPart: (part) =>
      recompute(
        {
          part,
          measured: null,
          layoutKey: null,
          settings: normalizeSettings({ quantity: part.suggested_quantities[0] ?? 1 }, get().settings),
          autoRecommend: { modelUrl: part.modelUrl, applied: false },
          onRecommendation: true,
        },
        undefined,
        "loaded",
      ),
    applyRecommendation: (part, sweep) => {
      const { autoRecommend: pending, settings, layoutKey } = get();
      if (!pending || part !== get().part || part.modelUrl !== pending.modelUrl) return;
      const measured = !!part.profile;
      // Applied once already: only the measured outline's result is applied again.
      if (pending.applied && !measured) return;
      const rec = sweep.recommendation;
      // Settled after the measured outline's result, or when nothing passes (nothing to wait for).
      const autoRecommend = measured || !rec ? null : { ...pending, applied: true };
      if (!rec || (settings.quantity === rec.quantity && layoutKey === rec.crate.layoutKey)) {
        set({ autoRecommend });
        return;
      }
      recompute(
        { settings: normalizeSettings({ quantity: rec.quantity }, settings), layoutKey: rec.crate.layoutKey, autoRecommend },
        "recommended",
        undefined,
        `Set to the recommended ${rec.quantity} per crate`,
      );
    },
    loadDesign: (part, settings, layoutKey, crateIndex = 0) =>
      recompute({ part, measured: null, layoutKey, crateIndex, settings: normalizeSettings(settings, DEFAULT_SETTINGS), ...EDITED }, undefined, "loaded"),
    restoreDesign: (part, settings, layoutKey, crateIndex, ranking) =>
      recompute(
        {
          part,
          measured: null,
          layoutKey,
          crateIndex,
          ranking,
          settings: normalizeSettings(settings, DEFAULT_SETTINGS),
          ...EDITED,
        },
        undefined,
        "restored",
      ),
    setCrateIndex: (index) => {
      const { plan, crateIndex } = get();
      if (index === crateIndex || !Number.isInteger(index) || index < 0 || index >= plan.crates.length) return;
      set({ crateIndex: index, result: plan.crates[index].result });
      emitDesignEdit({ type: "crate-switched" });
    },
    setMeasured: (measured) => set({ measured }),
    setPartProfile: (modelUrl, profile) => {
      const current = get().part;
      if (current.modelUrl !== modelUrl || current.profile) return;
      if (!profile) {
        // Analysis failed: blocking stays on the bounding box, so no second recommendation comes.
        if (get().autoRecommend?.applied) set({ autoRecommend: null });
        return;
      }
      // Shaped blocks change the cut list, so the view may hold a pin or hover on a line that is gone.
      redesign({ part: { ...current, profile } }, (prev, next) => ({ type: "refined", source: null, prev, next }));
    },
    setPartDetails: (input) => {
      const current = get().part;
      if (current.catalogDims) return "Catalog parts can't be edited.";
      const r = cleanPartDetails(input);
      if (!r.ok) return r.error;
      const { mass_kg, ...meta } = r.details;
      const part: LoadedPart = { ...current, ...meta };
      // An edit of the part's details is the person's own: the recommendation is no longer applied for them.
      set(EDITED);
      if (mass_kg !== undefined) {
        part.mass_kg = mass_kg;
        part.massAssumed = false;
        // Mass changes the construction, so the layout choice resets as for any other input.
        if (mass_kg !== current.mass_kg) {
          recompute({ part, layoutKey: null }, "mass");
          return null;
        }
      }
      // Name and material don't move anything: refresh the result (checks may quote the
      // part) without re-framing the camera or dropping the user's layout pick.
      const source: ChangeSource = mass_kg !== undefined ? "mass" : "material" in meta ? "material" : "name";
      redesign({ part }, (prev, next) => ({ type: "refined", source, prev, next }));
      return null;
    },
    setPartFrame: (patch) => {
      const current = get().part;
      if (!canSetFrame(current)) return "Catalog parts can't be edited.";
      const frame: PartFrame = { units: patch.units ?? current.modelUnits, up: patch.up ?? current.upAxis };
      if (frame.units === current.modelUnits && frame.up === current.upAxis) return null;
      // The person has looked at how the file is read, so the units are no longer just a guess.
      const part = framePart(current, frame);
      // A part whose rules are still the recommendation's (spec §7.16) waits for the one for its new
      // size: a quantity swept for a misread size means nothing. A part the person has edited keeps their rules.
      const autoRecommend = get().onRecommendation ? { modelUrl: part.modelUrl, applied: false } : null;
      recompute({ part, measured: part.dimensions_mm, layoutKey: null, autoRecommend }, "frame");
      return null;
    },
    // Settings are clamped or rejected per field here (normalizeSettings), so the domain never sees bad values.
    // An edit of the quantity, rules, layout, ranking or standards stops a pending recommendation (`autoRecommend`).
    setSettings: (patch) =>
      recompute({ settings: normalizeSettings(patch, get().settings, panelOptions(get().standards)), layoutKey: null, ...EDITED }, "rules"),
    resetRules: () => recompute({ settings: settingsFromStandards(get().standards, get().settings.quantity), layoutKey: null, ...EDITED }, "rules"),
    setLayoutKey: (layoutKey) => recompute({ layoutKey, ...EDITED }, "layout"),
    setStandards: (patch) => {
      const r = parseStandards(mergeStandards(get().standards, patch));
      if (!r.ok) return r.error;
      applyStandards(r.standards);
      return null;
    },
    resetStandards: () => applyStandards(DEFAULT_STANDARDS),
    loadSavedStandards: () => {
      const standards = loadStandards();
      if (standards !== get().standards) applyStandards(standards, false);
    },
    addCatalogParts: (parts) => {
      const byModel = new Map(get().extraParts.map((p) => [p.model, p]));
      for (const p of parts) byModel.set(p.model, p);
      set({ extraParts: [...byModel.values()] });
    },
    setRanking: (ranking) => {
      if (ranking !== get().ranking) recompute({ ranking, layoutKey: null, ...EDITED }, "layout");
    },
    recommendOnStartup: () => {
      const { part, autoRecommend } = get();
      if (!autoRecommend) set({ autoRecommend: { modelUrl: part.modelUrl, applied: false }, onRecommendation: true });
    },
  };
});

/**
 * The part on screen holds its model (`modelRegistry.ts`) for as long as it is the part. Replacing the
 * part (by any path: a load, a design, a restore) takes the new hold before letting go of the old, so
 * whatever else still holds the old model (the viewer until it swaps, an export, the saver) keeps it alive.
 * A frame, profile or detail edit keeps the same model and changes nothing here.
 */
let heldUrl = useDesigner.getState().part.modelUrl;
let partHold = models.acquire(heldUrl);
useDesigner.subscribe(({ part }) => {
  if (part.modelUrl === heldUrl) return;
  const previous = partHold;
  heldUrl = part.modelUrl;
  partHold = models.acquire(heldUrl);
  previous.release();
});
