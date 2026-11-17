import { create } from "zustand";
import { catalog, modelUrl } from "@/domain/catalog";
import type { Assembly } from "@/domain/crate";
import { computeDesign, DEFAULT_SETTINGS, type DesignResult } from "@/domain/design";
import { cleanPartDetails, type PartDetailsInput } from "@/domain/partDetails";
import { normalizeSettings, type CrateSettings, type DesignPart, type Part, type Vec3 } from "@/domain/schema";
import type { Units } from "@/lib/units";
import { anim } from "./motion";

/** The part being crated: catalog metadata or a GLB loaded at runtime. */
export interface LoadedPart extends DesignPart {
  modelUrl: string;
  /** Millimetres per model unit: 1000 for metre files, 1 for files read as millimetres. */
  mmPerUnit: number;
  suggested_quantities: number[];
  /** Catalog size to check the measured model against; absent for unknown files. */
  catalogDims?: Vec3;
  /** No mass came with the file, so a stand-in is in use. */
  massAssumed: boolean;
  /** The file was larger than 20 units across, so it was read as millimetres. */
  readAsMm: boolean;
}

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
export interface Hover {
  key?: string;
  assembly?: Assembly;
  source: "list" | "3d";
}

/** A size label drawn in the DOM over the canvas; the scene positions it each frame. */
export interface SizeLabel {
  text: string;
  /** Part dimension (ice blue) rather than crate dimension. */
  inner: boolean;
}

export interface Tooltip {
  x: number;
  y: number;
  title: string;
  detail: string;
}

/** Screen space the overlays cover, in px; the crate is centred in what is left. */
export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DesignerState {
  part: LoadedPart;
  /** Bounding box measured from the loaded model, in mm. */
  measured: Vec3 | null;
  settings: CrateSettings;
  layoutKey: string | null;
  result: DesignResult;
  /** Extra catalog entries from a dropped parts.json. */
  extraParts: Part[];

  units: Units;
  tab: Tab;
  view: ViewState;
  hover: Hover | null;
  pin: string | null;
  tooltip: Tooltip | null;
  labels: SizeLabel[];
  panelsHidden: boolean;
  insets: Insets;
  loadMessage: string;
  /** Bumped whenever the camera should re-frame the crate. */
  fit: { nonce: number; instant: boolean };

  setPart: (part: LoadedPart) => void;
  setMeasured: (size: Vec3) => void;
  /**
   * Name, material and mass for a part loaded without catalog data. Validated;
   * returns an error message (and changes nothing) if the input is invalid or the
   * part is a catalog part, which is read-only.
   */
  setPartDetails: (details: PartDetailsInput) => string | null;
  setSettings: (patch: Partial<CrateSettings>) => void;
  resetRules: () => void;
  setLayoutKey: (key: string | null) => void;
  addCatalogParts: (parts: Part[]) => void;
  setUnits: (u: Units) => void;
  setTab: (t: Tab) => void;
  setMode: (m: Mode) => void;
  setView: (patch: Partial<ViewState>) => void;
  setHover: (h: Hover | null) => void;
  setPin: (key: string | null) => void;
  setTooltip: (t: Tooltip | null) => void;
  setLabels: (l: SizeLabel[]) => void;
  togglePanels: () => void;
  setInsets: (i: Insets) => void;
  setLoadMessage: (m: string) => void;
  requestFit: (instant?: boolean) => void;
}

export const DEFAULT_PART_ID = "PART-001";

export function catalogPart(p: Part, url = modelUrl(p)): LoadedPart {
  return {
    id: p.id,
    name: p.name,
    material: p.material,
    mass_kg: p.mass_kg,
    dimensions_mm: p.dimensions_mm,
    suggested_quantities: p.suggested_quantities,
    modelUrl: url,
    mmPerUnit: 1000,
    catalogDims: p.dimensions_mm,
    massAssumed: false,
    readAsMm: false,
  };
}

const initialPart = catalogPart(catalog.parts.find((p) => p.id === DEFAULT_PART_ID)!);

export function currentMode(v: Pick<ViewState, "lid" | "front" | "explode">): Mode | null {
  if (v.explode === 0 && v.lid && v.front) return "closed";
  if (v.explode === 0 && !v.lid && !v.front) return "open";
  if (v.explode === 1 && v.lid && v.front) return "exploded";
  return null;
}

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useDesigner = create<DesignerState>()((set, get) => {
  /** Recompute the design after any input change, dropping a pin whose cut-list line is gone. */
  const recompute = (patch: Partial<DesignerState>) => {
    const next = { ...get(), ...patch };
    const result = computeDesign(next.part, next.settings, next.layoutKey);
    const pinGone = next.pin && !result.design?.bom.some((l) => l.key === next.pin);
    const sizeChanged = result.design?.layout.key !== get().result.design?.layout.key || patch.part;
    set({
      ...patch,
      result,
      hover: null,
      ...(pinGone ? { pin: null } : {}),
      ...(sizeChanged ? { fit: { nonce: get().fit.nonce + 1, instant: false } } : {}),
    });
  };

  return {
    part: initialPart,
    measured: null,
    settings: DEFAULT_SETTINGS,
    layoutKey: null,
    result: computeDesign(initialPart, DEFAULT_SETTINGS),
    extraParts: [],

    units: "metric",
    tab: "overview",
    view: { lid: true, front: true, explode: 0, blocking: true, parts: true, dims: true, camera: "iso" },
    hover: null,
    pin: null,
    tooltip: null,
    labels: [],
    panelsHidden: false,
    insets: { left: 0, top: 0, right: 0, bottom: 0 },
    loadMessage: "",
    fit: { nonce: 0, instant: true },

    setPart: (part) =>
      recompute({
        part,
        measured: null,
        pin: null,
        layoutKey: null,
        settings: normalizeSettings({ quantity: part.suggested_quantities[0] ?? 1 }, get().settings),
      }),
    setMeasured: (measured) => set({ measured }),
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
          recompute({ part, layoutKey: null });
          return null;
        }
      }
      // Name and material don't move anything: refresh the result (checks may quote the
      // part) without re-framing the camera or dropping the user's layout pick.
      const { settings, layoutKey } = get();
      set({ part, result: computeDesign(part, settings, layoutKey) });
      return null;
    },
    // Settings are clamped or rejected per field here (normalizeSettings), so the domain never sees bad values.
    setSettings: (patch) => recompute({ settings: normalizeSettings(patch, get().settings), layoutKey: null }),
    resetRules: () => recompute({ settings: { ...DEFAULT_SETTINGS, quantity: get().settings.quantity }, layoutKey: null }),
    setLayoutKey: (layoutKey) => recompute({ layoutKey }),
    addCatalogParts: (parts) => {
      const byModel = new Map(get().extraParts.map((p) => [p.model, p]));
      for (const p of parts) byModel.set(p.model, p);
      set({ extraParts: [...byModel.values()] });
    },
    setUnits: (units) => set({ units }),
    setTab: (tab) => set({ tab }),
    setMode: (mode) => {
      const view = { ...get().view, lid: mode !== "open", front: mode !== "open", explode: mode === "exploded" ? 1 : 0 };
      if (reducedMotion()) {
        anim.explode = view.explode;
        anim.lidAlpha = anim.frontAlpha = view.lid ? 1 : 0;
      }
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
    setLabels: (labels) => {
      const a = get().labels;
      const same = a.length === labels.length && a.every((l, i) => l.text === labels[i].text && l.inner === labels[i].inner);
      if (!same) set({ labels });
    },
    togglePanels: () => set({ panelsHidden: !get().panelsHidden }),
    setInsets: (insets) => {
      const a = get().insets;
      if (a.left !== insets.left || a.top !== insets.top || a.right !== insets.right || a.bottom !== insets.bottom) {
        set({ insets, fit: { nonce: get().fit.nonce + 1, instant: true } });
      }
    },
    setLoadMessage: (loadMessage) => set({ loadMessage }),
    requestFit: (instant = false) => set({ fit: { nonce: get().fit.nonce + 1, instant } }),
  };
});
