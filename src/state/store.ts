import { create } from "zustand";
import { catalog } from "@/domain/catalog";
import type { Assembly } from "@/domain/crate";
import { DEFAULT_SETTINGS, settingsFromStandards, type DesignResult, type Ranking } from "@/domain/design";
import { diffDesigns, type DesignChange } from "@/domain/diff";
import { cleanPartDetails, type PartDetailsInput } from "@/domain/partDetails";
import type { PartProfile } from "@/domain/profile";
import type { ShipmentPlan } from "@/domain/shipment";
import { normalizeSettings, type CrateSettings, type Part, type Vec3 } from "@/domain/schema";
import { DEFAULT_STANDARDS, mergeStandards, panelOptions, parseStandards, type DeepPartial, type ShopStandards } from "@/domain/standards";
import type { DesignResponse, EngineStamp } from "@/engine/schemas";
import { catalogPart, type LoadedPart } from "@/lib/part";
import type { Units } from "@/lib/units";
import { loadStandards, saveStandards, type KeyValueStore } from "./standardsStorage";
import { engine } from "./engineClient";
import { DEFAULT_UNITS, loadUnits, saveUnits } from "./unitsStorage";

export type Tab = "overview" | "layouts" | "cut" | "rules" | "checks";
export type Mode = "closed" | "open" | "exploded";
export type CameraPreset = "iso" | "top" | "front" | "end";

export interface ViewState {
  /** Targets; the scene eases toward them (see motion.ts). */
  lid: boolean;
  front: boolean;
  explode: number;
  blocking: boolean;
  parts: boolean;
  dims: boolean;
  /** Last camera preset chosen, or null once the user orbits. */
  camera: CameraPreset | null;
}

/** A cut-list line or assembly that is lit up. `list` hovers also fade everything else. */
interface Hover {
  key?: string;
  assembly?: Assembly;
  source: "list" | "3d";
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  detail: string;
}

/** Screen space the overlays cover, in px; the crate is centred in what is left. */
interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Which input an edit came from, so the change note can sit by it. */
/** How the load row shows its message: a note goes by itself, an error waits to be dismissed. */
export type LoadMessageKind = "note" | "error";

export type ChangeSource = "name" | "material" | "mass" | "rules" | "layout";

/** What the last input change did to the design; cleared after `CHANGE_NOTE_MS`. */
interface LastChange {
  /** Increments per change, so the UI can restart its highlight. */
  id: number;
  /** `Date.now()` when the change was made. */
  at: number;
  source: ChangeSource;
  /** From `diffDesigns(previous, next)`; empty when nothing moved. */
  changes: DesignChange[];
}

/** How long the change note stays (it fades over the end). Longer than the Overview flash (1.2 s) so it can be read. */
const CHANGE_NOTE_MS = 5000;

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
  extraParts: Part[];
  /** The shop's house rules every design is built to. Saved in localStorage. */
  standards: ShopStandards;

  units: Units;
  tab: Tab;
  view: ViewState;
  hover: Hover | null;
  pin: string | null;
  tooltip: Tooltip | null;
  panelsHidden: boolean;
  insets: Insets;
  loadMessage: string;
  /** An error stays until dismissed or the next load; a note goes by itself. */
  loadMessageKind: LoadMessageKind;
  /** Bumped whenever the camera should re-frame the crate. */
  fit: { nonce: number; instant: boolean };
  /** The last edit's effect on the design. Units changes and loading a part don't set it. */
  lastChange: LastChange | null;
  /** Narrow screens: the island is a right-side drawer; true while it is open. Separate from `panelsHidden`. */
  drawerOpen: boolean;
  /** How the recommended layout is chosen: `volume` (the default), `cost` or `density`. Kept across edits. */
  ranking: Ranking;
  /** Time to design: `Date.now()` when the current part was loaded, or null before the app mounts. */
  designStartedAt: number | null;
  /** Milliseconds from loading the part to its first export (CSV, design JSON or GLB); null until then. */
  designedInMs: number | null;
  /** True while the last-opened crate is being reopened after mount; the scene waits for it. */
  restoring: boolean;

  setPart: (part: LoadedPart) => void;
  /** Opens a saved design: the part with its own settings and layout (null = recommended). */
  loadDesign: (part: LoadedPart, settings: CrateSettings, layoutKey: string | null, crateIndex?: number) => void;
  /**
   * Reopens the last-opened crate after a reload: like `loadDesign`, plus its tab and ranking.
   * Not the same thing as `restoreDesign` in `@/domain/designFile`, which rebuilds a part's
   * settings from a design file; the loader runs that first and hands its result to this action.
   * The time-to-design clock stays stopped (no "Designed in" note) until a new part loads.
   */
  restoreDesign: (part: LoadedPart, settings: CrateSettings, layoutKey: string | null, crateIndex: number, ui: { tab: Tab; ranking: Ranking }) => void;
  setRestoring: (restoring: boolean) => void;
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
  /** Shows these units and remembers them in this browser (`storage` is for tests). */
  setUnits: (u: Units, storage?: KeyValueStore | null) => void;
  /** Applies the units saved in this browser, if any. Called once after the app mounts. */
  loadSavedUnits: (storage?: KeyValueStore | null) => void;
  setTab: (t: Tab) => void;
  setMode: (m: Mode) => void;
  setView: (patch: Partial<ViewState>) => void;
  setHover: (h: Hover | null) => void;
  setPin: (key: string | null) => void;
  setTooltip: (t: Tooltip | null) => void;
  togglePanels: () => void;
  setInsets: (i: Insets) => void;
  setLoadMessage: (m: string, kind?: LoadMessageKind) => void;
  requestFit: (instant?: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  /** Re-ranks the layouts by volume, crate cost or freight; resets the layout pick. */
  setRanking: (ranking: Ranking) => void;
  /** Starts the time-to-design clock if it isn't running (called once after mount). */
  startDesignClock: (now?: number) => void;
  /**
   * Records the time from the clock start to the first export or download of the design on screen.
   * Later exports don't move it; an edit clears it, and the next export records the new time.
   */
  markExported: (now?: number) => void;
}

const DEFAULT_PART_ID = "PART-001";

const initialPart = catalogPart(catalog.parts.find((p) => p.id === DEFAULT_PART_ID)!);

export function currentMode(v: Pick<ViewState, "lid" | "front" | "explode">): Mode | null {
  if (v.explode === 0 && v.lid && v.front) return "closed";
  if (v.explode === 0 && !v.lid && !v.front) return "open";
  if (v.explode === 1 && v.lid && v.front) return "exploded";
  return null;
}

type Planned = Pick<DesignerState, "plan" | "crateIndex" | "result">;

/** The preloaded part's plan: one crate at the default quantity, designed in this thread. */
function initialPlan(): Planned & Pick<DesignerState, "designedFrom"> {
  const input: PlanInput = { part: initialPart, settings: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS, layoutKey: null, ranking: "volume" };
  const out = engine.designSync(input);
  return { ...place(out.plan, 0), designedFrom: designed(input, out) };
}

/** A fresh time-to-design clock, for a newly loaded part or design. */
const newDesignClock = (): Pick<DesignerState, "designStartedAt" | "designedInMs"> => ({ designStartedAt: Date.now(), designedInMs: null });

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

/** Clears a pin, and a hover, that name a cut-list line the new design no longer has. */
function dropStaleLines(s: Pick<DesignerState, "pin" | "hover">, result: DesignResult): Partial<Pick<DesignerState, "pin" | "hover">> {
  const has = (key: string) => result.design?.bom.some((l) => l.key === key);
  return {
    ...(s.pin && !has(s.pin) ? { pin: null } : {}),
    ...(s.hover?.key && !has(s.hover.key) ? { hover: null } : {}),
  };
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useDesigner = create<DesignerState>()((set, get) => {
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The `lastChange` for an edit from `source` that moves the design from `prev` to `next`. */
  const change = (source: ChangeSource, prev: DesignResult, next: DesignResult): Pick<DesignerState, "lastChange"> => {
    clearTimeout(changeTimer);
    // A problem on either side (no design) has its own message; there is nothing to compare.
    if (!prev.design || !next.design) return { lastChange: null };
    const id = (get().lastChange?.id ?? 0) + 1;
    changeTimer = setTimeout(() => {
      if (get().lastChange?.id === id) set({ lastChange: null });
    }, CHANGE_NOTE_MS);
    return { lastChange: { id, at: Date.now(), source, changes: diffDesigns(prev.design, next.design) } };
  };

  /**
   * Edits whose design is still in the engine's worker, oldest first. Always empty where the
   * engine runs in this thread (tests, server rendering): there the design lands before
   * `redesign` returns, in the same `set` as the edit, exactly as a direct call would.
   */
  let waiting: { ticket: number; patch: Partial<DesignerState>; restoring?: boolean }[] = [];
  let tickets = 0;

  /**
   * Applies an edit and designs for it (spec §5.1). With the worker, the edit is stored at once
   * (its control never lags) and its design lands when the engine answers; a newer edit's design
   * supersedes an older one still on its way. What waits for the design: the plan, the crate
   * type shown (`patch.crateIndex` may only exist in the new plan) and `finish`, which adds what
   * follows from the design. `next` is the state the design lands on and `patch` every edit
   * that lands with it.
   */
  const redesign = (
    patch: Partial<DesignerState>,
    finish: (planned: Planned, next: DesignerState, patch: Partial<DesignerState>) => Partial<DesignerState>,
  ) => {
    const ticket = ++tickets;
    const now = { ...patch };
    delete now.crateIndex;
    waiting.push({ ticket, patch });
    const input = planInput({ ...get(), ...now });
    let inline = true;
    engine.design(input, (out) => {
      const landed = waiting.filter((w) => w.ticket <= ticket);
      waiting = waiting.filter((w) => w.ticket > ticket);
      const merged: Partial<DesignerState> = Object.assign({}, ...landed.map((w) => w.patch));
      const restoring = landed.findLast((w) => w.restoring !== undefined)?.restoring;
      const next = { ...get(), ...(inline ? now : {}), ...("crateIndex" in merged ? { crateIndex: merged.crateIndex } : {}) };
      const planned = place(out.plan, next.crateIndex);
      set({
        ...(inline ? now : {}),
        ...planned,
        designedFrom: designed(input, out),
        ...(restoring !== undefined ? { restoring } : {}),
        ...finish(planned, next, merged),
      });
    });
    inline = false;
    if (waiting.some((w) => w.ticket === ticket)) set(now);
  };

  /**
   * Recompute the design after any input change, dropping a pin whose cut-list line is gone.
   * With a `source`, records what moved in `lastChange`; without one (a new part) clears it.
   */
  const recompute = (patch: Partial<DesignerState>, source?: ChangeSource) =>
    redesign(patch, ({ result }, next, merged) => {
      // "Designed in" times the design that was exported; an edit makes it stale, so it goes.
      const staleClock = get().designedInMs !== null && !("designedInMs" in merged);
      const sizeChanged = result.design?.layout.key !== get().result.design?.layout.key || merged.part;
      return {
        ...(source ? change(source, get().result, result) : { lastChange: null }),
        ...(staleClock ? { designedInMs: null } : {}),
        hover: null,
        ...dropStaleLines({ pin: next.pin, hover: null }, result),
        ...(sizeChanged ? { fit: { nonce: get().fit.nonce + 1, instant: false } } : {}),
      };
    });

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

    units: DEFAULT_UNITS,
    tab: "overview",
    view: { lid: true, front: true, explode: 0, blocking: true, parts: true, dims: true, camera: "iso" },
    hover: null,
    pin: null,
    tooltip: null,
    panelsHidden: false,
    insets: { left: 0, top: 0, right: 0, bottom: 0 },
    loadMessage: "",
    loadMessageKind: "note",
    fit: { nonce: 0, instant: true },
    lastChange: null,
    drawerOpen: false,
    ranking: "volume",
    designStartedAt: null,
    designedInMs: null,
    restoring: false,

    setPart: (part) =>
      recompute({
        ...newDesignClock(),
        part,
        measured: null,
        pin: null,
        layoutKey: null,
        settings: normalizeSettings({ quantity: part.suggested_quantities[0] ?? 1 }, get().settings),
      }),
    loadDesign: (part, settings, layoutKey, crateIndex = 0) =>
      recompute({ ...newDesignClock(), part, measured: null, pin: null, layoutKey, crateIndex, settings: normalizeSettings(settings, DEFAULT_SETTINGS) }),
    restoreDesign: (part, settings, layoutKey, crateIndex, { tab, ranking }) =>
      recompute({
        designStartedAt: null,
        designedInMs: null,
        part,
        measured: null,
        pin: null,
        layoutKey,
        crateIndex,
        tab,
        ranking,
        settings: normalizeSettings(settings, DEFAULT_SETTINGS),
      }),
    setRestoring: (restoring) => {
      // While a reopened crate's design is on its way, the scene stays held until it lands.
      if (waiting.length) waiting[waiting.length - 1].restoring = restoring;
      else if (get().restoring !== restoring) set({ restoring });
    },
    setCrateIndex: (index) => {
      const { plan, crateIndex, fit } = get();
      if (index === crateIndex || !Number.isInteger(index) || index < 0 || index >= plan.crates.length) return;
      set({ crateIndex: index, result: plan.crates[index].result, pin: null, hover: null, fit: { nonce: fit.nonce + 1, instant: false } });
    },
    setMeasured: (measured) => set({ measured }),
    setPartProfile: (modelUrl, profile) => {
      const current = get().part;
      if (!profile || current.modelUrl !== modelUrl || current.profile) return;
      // Shaped blocks change the cut list, so a pin or hover may name a line that is gone.
      redesign({ part: { ...current, profile } }, ({ result }) => dropStaleLines(get(), result));
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
      const source: ChangeSource = mass_kg !== undefined ? "mass" : "material" in meta ? "material" : "name";
      redesign({ part }, ({ result }) => change(source, get().result, result));
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
    setUnits: (units, storage) => {
      set({ units });
      saveUnits(units, storage);
    },
    loadSavedUnits: (storage) => {
      const units = loadUnits(storage);
      if (units && units !== get().units) set({ units });
    },
    setTab: (tab) => set({ tab }),
    setMode: (mode) => {
      const view = { ...get().view, lid: mode !== "open", front: mode !== "open", explode: mode === "exploded" ? 1 : 0 };
      set({ view, fit: { nonce: get().fit.nonce + 1, instant: false } });
    },
    setView: (patch) => set({ view: { ...get().view, ...patch } }),
    setHover: (hover) => {
      const a = get().hover;
      const same = (!a && !hover) || (a && hover && a.key === hover.key && a.assembly === hover.assembly && a.source === hover.source);
      if (!same) set({ hover });
    },
    setPin: (pin) => set({ pin }),
    setTooltip: (tooltip) => set({ tooltip }),
    togglePanels: () => set({ panelsHidden: !get().panelsHidden }),
    setInsets: (insets) => {
      const a = get().insets;
      if (a.left !== insets.left || a.top !== insets.top || a.right !== insets.right || a.bottom !== insets.bottom) {
        set({ insets, fit: { nonce: get().fit.nonce + 1, instant: true } });
      }
    },
    setLoadMessage: (loadMessage, loadMessageKind = "note") => set({ loadMessage, loadMessageKind }),
    requestFit: (instant = false) => set({ fit: { nonce: get().fit.nonce + 1, instant } }),
    setDrawerOpen: (drawerOpen) => {
      if (get().drawerOpen !== drawerOpen) set({ drawerOpen });
    },
    setRanking: (ranking) => {
      if (ranking !== get().ranking) recompute({ ranking, layoutKey: null }, "layout");
    },
    startDesignClock: (now = Date.now()) => {
      if (get().designStartedAt === null) set({ designStartedAt: now, designedInMs: null });
    },
    markExported: (now = Date.now()) => {
      const { designStartedAt, designedInMs } = get();
      if (designStartedAt !== null && designedInMs === null) set({ designedInMs: Math.max(0, now - designStartedAt) });
    },
  };
});
