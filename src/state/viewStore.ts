import { create } from "zustand";
import type { Units } from "@/lib/units";
import { onDesignEdit, type DesignEdit } from "./designEvents";
import type { KeyValueStore } from "./persist";
import { DEFAULT_UNITS, loadUnits, saveUnits } from "./unitsStorage";

/** How the load row shows its message: a note goes by itself, an error waits to be dismissed. */
export type LoadMessageKind = "note" | "error";

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

/** Screen space the overlays cover, in px; the crate is centred in what is left. */
export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A tooltip over a board in the 3D view, in screen px. */
export interface Tooltip {
  x: number;
  y: number;
  title: string;
  detail: string;
}

/**
 * Everything about how the design is shown right now: nothing here is an input to the design, and
 * nothing here is saved with it. The design itself lives in `useDesigner` (`./store.ts`).
 */
export interface ViewStoreState {
  tab: Tab;
  /** The 3D view's toggles and camera preset. */
  view: ViewState;
  insets: Insets;
  /** Bumped whenever the camera should re-frame the crate. */
  fit: { nonce: number; instant: boolean };
  /** The display units. Saved in this browser (spec §9), not with a design. */
  units: Units;
  tooltip: Tooltip | null;
  panelsHidden: boolean;
  loadMessage: string;
  /** An error stays until dismissed or the next load; a note goes by itself. */
  loadMessageKind: LoadMessageKind;
  /** Narrow screens: the island is a right-side drawer; true while it is open. Separate from `panelsHidden`. */
  drawerOpen: boolean;
  /** True while the last-opened crate is being reopened after mount; the scene waits for it. */
  restoring: boolean;

  /** Shows these units and remembers them in this browser (`storage` is for tests). */
  setUnits: (u: Units, storage?: KeyValueStore | null) => void;
  /** Applies the units saved in this browser, if any. Called once after the app mounts. */
  loadSavedUnits: (storage?: KeyValueStore | null) => void;
  setTab: (t: Tab) => void;
  setMode: (m: Mode) => void;
  setView: (patch: Partial<ViewState>) => void;
  setInsets: (i: Insets) => void;
  requestFit: (instant?: boolean) => void;
  setTooltip: (t: Tooltip | null) => void;
  togglePanels: () => void;
  setLoadMessage: (m: string, kind?: LoadMessageKind) => void;
  setDrawerOpen: (open: boolean) => void;
  setRestoring: (restoring: boolean) => void;
}

export function currentMode(v: Pick<ViewState, "lid" | "front" | "explode">): Mode | null {
  if (v.explode === 0 && v.lid && v.front) return "closed";
  if (v.explode === 0 && !v.lid && !v.front) return "open";
  if (v.explode === 1 && v.lid && v.front) return "exploded";
  return null;
}

export const useView = create<ViewStoreState>()((set, get) => ({
  tab: "overview",
  view: { lid: true, front: true, explode: 0, blocking: true, parts: true, dims: true, camera: "iso" },
  insets: { left: 0, top: 0, right: 0, bottom: 0 },
  fit: { nonce: 0, instant: true },
  units: DEFAULT_UNITS,
  tooltip: null,
  panelsHidden: false,
  loadMessage: "",
  loadMessageKind: "note",
  drawerOpen: false,
  restoring: false,

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
  setInsets: (insets) => {
    const a = get().insets;
    if (a.left !== insets.left || a.top !== insets.top || a.right !== insets.right || a.bottom !== insets.bottom) {
      set({ insets, fit: { nonce: get().fit.nonce + 1, instant: true } });
    }
  },
  requestFit: (instant = false) => set({ fit: { nonce: get().fit.nonce + 1, instant } }),
  setTooltip: (tooltip) => set({ tooltip }),
  togglePanels: () => set({ panelsHidden: !get().panelsHidden }),
  setLoadMessage: (loadMessage, loadMessageKind = "note") => set({ loadMessage, loadMessageKind }),
  setDrawerOpen: (drawerOpen) => {
    if (get().drawerOpen !== drawerOpen) set({ drawerOpen });
  },
  setRestoring: (restoring) => {
    if (get().restoring !== restoring) set({ restoring });
  },
}));

/**
 * How the view reacts when the design changes. Subscribed once, here, to the design store's
 * `designEvents`; the design store knows nothing about this.
 */
function onEdit(edit: DesignEdit) {
  const { requestFit } = useView.getState();
  switch (edit.type) {
    case "opened":
    case "crate-switched":
      requestFit();
      break;
    case "edited":
      // A different crate size, or a different part, needs framing again.
      if (edit.partReplaced || edit.next.design?.layout.key !== edit.prev.design?.layout.key) requestFit();
      break;
    case "refined":
      break;
  }
}
onDesignEdit(onEdit);
