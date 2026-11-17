import { create } from "zustand";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS, settingsFromStandards, type DesignResult, type Ranking } from "@/domain/design";
import { cleanPartDetails, type PartDetailsInput } from "@/domain/partDetails";
import type { PartProfile } from "@/domain/profile";
import { planShipment, type ShipmentPlan } from "@/domain/shipment";
import { normalizeSettings, type CrateSettings, type Part, type Vec3 } from "@/domain/schema";
import { DEFAULT_STANDARDS, mergeStandards, panelOptions, parseStandards, type DeepPartial, type ShopStandards } from "@/domain/standards";
import { canSetFrame, catalogPart, framePart, type LoadedPart } from "@/lib/part";
import type { PartFrame } from "@/lib/partFrame";
import { emitDesignEdit, type ChangeSource } from "./designEvents";
import { loadStandards, saveStandards } from "./standardsStorage";

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
  /** Extra catalog entries from a dropped parts.json. */
  extraParts: Part[];
  /** The shop's house rules every design is built to. Saved in localStorage. */
  standards: ShopStandards;

  /** How the recommended layout is chosen: `volume` (the default), `cost` or `density`. Kept across edits. */
  ranking: Ranking;

  setPart: (part: LoadedPart) => void;
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
  addCatalogParts: (parts: Part[]) => void;
  /** Re-ranks the layouts by volume, crate cost or freight; resets the layout pick. */
  setRanking: (ranking: Ranking) => void;
}

const DEFAULT_PART_ID = "PART-001";

const initialPart = catalogPart(catalog.parts.find((p) => p.id === DEFAULT_PART_ID)!);

/** The preloaded part's plan: one crate at the default quantity. */
function initialPlan(): Pick<DesignerState, "plan" | "crateIndex" | "result"> {
  const plan = planShipment(initialPart, DEFAULT_SETTINGS);
  return { plan, crateIndex: 0, result: plan.crates[0].result };
}

type PlanInput = Pick<DesignerState, "part" | "settings" | "layoutKey" | "standards" | "ranking" | "crateIndex">;

/**
 * Plans the shipment for these inputs and picks the crate type to show: the current one while
 * the plan still has it, else the first.
 */
function replan(s: PlanInput): Pick<DesignerState, "plan" | "crateIndex" | "result"> {
  const plan = planShipment(s.part, s.settings, s.layoutKey, s.standards, s.ranking);
  const crateIndex = s.crateIndex < plan.crates.length ? s.crateIndex : 0;
  return { plan, crateIndex, result: plan.crates[crateIndex].result };
}

export const useDesigner = create<DesignerState>()((set, get) => {
  /**
   * Recompute the design after any input change, then tell the view what happened
   * (`designEvents.ts`): `source` is the input behind a change note, `opened` says a part or
   * saved design was put on screen rather than edited.
   */
  const recompute = (patch: Partial<DesignerState>, source?: ChangeSource, opened?: "loaded" | "restored") => {
    const prev = get().result;
    const { plan, crateIndex, result } = replan({ ...get(), ...patch });
    set({ ...patch, plan, crateIndex, result });
    emitDesignEdit(
      opened
        ? { type: "opened", restored: opened === "restored", prev, next: result }
        : { type: "edited", source: source ?? null, partReplaced: Boolean(patch.part), prev, next: result },
    );
  };

  /** Switches to new standards: carries changed defaults into the rules, re-designs and saves. */
  const applyStandards = (standards: ShopStandards, save = true) => {
    const { settings, standards: old } = get();
    const next = { ...settings };
    for (const key of ["partGapMm", "wallClearanceMm", "maxLayers"] as const) {
      if (standards.defaults[key] !== old.defaults[key]) next[key] = standards.defaults[key];
    }
    // A panel thickness the new stock no longer includes goes back to auto rather than lingering unselectable.
    if (next.panelThickness !== "auto" && !panelOptions(standards).includes(next.panelThickness)) next.panelThickness = "auto";
    recompute({ standards, settings: normalizeSettings(next, settings), layoutKey: null });
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

    setPart: (part) =>
      recompute(
        {
          part,
          measured: null,
          layoutKey: null,
          settings: normalizeSettings({ quantity: part.suggested_quantities[0] ?? 1 }, get().settings),
        },
        undefined,
        "loaded",
      ),
    loadDesign: (part, settings, layoutKey, crateIndex = 0) =>
      recompute({ part, measured: null, layoutKey, crateIndex, settings: normalizeSettings(settings, DEFAULT_SETTINGS) }, undefined, "loaded"),
    restoreDesign: (part, settings, layoutKey, crateIndex, ranking) =>
      recompute(
        {
          part,
          measured: null,
          layoutKey,
          crateIndex,
          ranking,
          settings: normalizeSettings(settings, DEFAULT_SETTINGS),
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
      const { part: current, settings, layoutKey, standards, ranking, crateIndex, result: prev } = get();
      if (!profile || current.modelUrl !== modelUrl || current.profile) return;
      const part: LoadedPart = { ...current, profile };
      const next = replan({ part, settings, layoutKey, standards, ranking, crateIndex });
      set({ part, ...next });
      // Shaped blocks change the cut list, so the view may hold a pin or hover on a line that is gone.
      emitDesignEdit({ type: "refined", source: null, prev, next: next.result });
    },
    setPartDetails: (input) => {
      const current = get().part;
      if (current.catalogDims) return "Catalog parts can't be edited.";
      const r = cleanPartDetails(input);
      if (!r.ok) return r.error;
      const { mass_kg, ...meta } = r.details;
      const part: LoadedPart = { ...current, ...meta };
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
      const prev = get().result;
      const { plan, crateIndex, result } = replan({ ...get(), part });
      const source: ChangeSource = mass_kg !== undefined ? "mass" : "material" in meta ? "material" : "name";
      set({ part, plan, crateIndex, result });
      emitDesignEdit({ type: "refined", source, prev, next: result });
      return null;
    },
    setPartFrame: (patch) => {
      const current = get().part;
      if (!canSetFrame(current)) return "Catalog parts can't be edited.";
      const frame: PartFrame = { units: patch.units ?? current.modelUnits, up: patch.up ?? current.upAxis };
      if (frame.units === current.modelUnits && frame.up === current.upAxis) return null;
      // The person has looked at how the file is read, so the units are no longer just a guess.
      const part = framePart(current, frame);
      recompute({ part, measured: part.dimensions_mm, layoutKey: null }, "frame");
      return null;
    },
    // Settings are clamped or rejected per field here (normalizeSettings), so the domain never sees bad values.
    setSettings: (patch) => recompute({ settings: normalizeSettings(patch, get().settings, panelOptions(get().standards)), layoutKey: null }, "rules"),
    resetRules: () => recompute({ settings: settingsFromStandards(get().standards, get().settings.quantity), layoutKey: null }, "rules"),
    setLayoutKey: (layoutKey) => recompute({ layoutKey }, "layout"),
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
      if (ranking !== get().ranking) recompute({ ranking, layoutKey: null }, "layout");
    },
  };
});
