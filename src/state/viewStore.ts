import { create } from "zustand";
import type { Units } from "@/lib/units";
import type { KeyValueStore } from "./persist";
import { DEFAULT_UNITS, loadUnits, saveUnits } from "./unitsStorage";

/** How the load row shows its message: a note goes by itself, an error waits to be dismissed. */
export type LoadMessageKind = "note" | "error";

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
  setTooltip: (t: Tooltip | null) => void;
  togglePanels: () => void;
  setLoadMessage: (m: string, kind?: LoadMessageKind) => void;
  setDrawerOpen: (open: boolean) => void;
  setRestoring: (restoring: boolean) => void;
}

export const useView = create<ViewStoreState>()((set, get) => ({
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
