import { create } from "zustand";
import type { Assembly } from "@/domain/crate";
import type { DesignResult } from "@/domain/design";
import { diffDesigns, type DesignChange } from "@/domain/diff";
import type { Units } from "@/lib/units";
import { onDesignEdit, type ChangeSource, type DesignEdit } from "./designEvents";
import type { KeyValueStore } from "./persist";
import { DEFAULT_UNITS, loadUnits, saveUnits } from "./unitsStorage";

/** How the load row shows its message: a note goes by itself, an error waits to be dismissed. */
type LoadMessageKind = "note" | "error";

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
interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A cut-list line or assembly that is lit up. `list` hovers also fade everything else. */
interface Hover {
  key?: string;
  assembly?: Assembly;
  source: "list" | "3d";
}

/** What the last input change did to the design; cleared after `CHANGE_NOTE_MS`. */
interface LastChange {
  /** Increments per change, so the UI can restart its highlight. */
  id: number;
  /** `Date.now()` when the change was made. */
  at: number;
  source: ChangeSource;
  /** From `diffDesigns(previous, next)`; empty when nothing moved. */
  changes: DesignChange[];
  /** What the screen says instead of the diff's summary ("Set to the recommended 34 per crate"); the diff stays the detail. */
  note?: string;
}

/** How long the change note stays (it fades over the end). Longer than the Overview flash (1.2 s) so it can be read. */
const CHANGE_NOTE_MS = 5000;

/** A tooltip over a board in the 3D view, in screen px. */
interface Tooltip {
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
  hover: Hover | null;
  pin: string | null;
  /** The last edit's effect on the design. Units changes and loading a part don't set it. */
  lastChange: LastChange | null;
  /** Time to design: `Date.now()` when the current part was loaded, or null before the app mounts. */
  designStartedAt: number | null;
  /** Milliseconds from loading the part to its first export (CSV, design JSON or GLB); null until then. */
  designedInMs: number | null;
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
  setHover: (h: Hover | null) => void;
  setPin: (key: string | null) => void;
  setTooltip: (t: Tooltip | null) => void;
  /** Starts the time-to-design clock if it isn't running (called once after mount). */
  startDesignClock: (now?: number) => void;
  /**
   * Records the time from the clock start to the first export or download of the design on screen.
   * Later exports don't move it; an edit clears it, and the next export records the new time.
   */
  markExported: (now?: number) => void;
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
  hover: null,
  pin: null,
  lastChange: null,
  designStartedAt: null,
  designedInMs: null,
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
  setHover: (hover) => {
    const a = get().hover;
    const same = (!a && !hover) || (a && hover && a.key === hover.key && a.assembly === hover.assembly && a.source === hover.source);
    if (!same) set({ hover });
  },
  setPin: (pin) => set({ pin }),
  setTooltip: (tooltip) => set({ tooltip }),
  startDesignClock: (now = Date.now()) => {
    if (get().designStartedAt === null) set({ designStartedAt: now, designedInMs: null });
  },
  markExported: (now = Date.now()) => {
    const { designStartedAt, designedInMs } = get();
    if (designStartedAt !== null && designedInMs === null) set({ designedInMs: Math.max(0, now - designStartedAt) });
  },
  togglePanels: () => set({ panelsHidden: !get().panelsHidden }),
  setLoadMessage: (loadMessage, loadMessageKind = "note") => set({ loadMessage, loadMessageKind }),
  setDrawerOpen: (drawerOpen) => {
    if (get().drawerOpen !== drawerOpen) set({ drawerOpen });
  },
  setRestoring: (restoring) => {
    if (get().restoring !== restoring) set({ restoring });
  },
}));

/** Clears a pin, and a hover, that name a cut-list line the new design no longer has. */
function dropStaleLines(s: Pick<ViewStoreState, "pin" | "hover">, result: DesignResult): Partial<Pick<ViewStoreState, "pin" | "hover">> {
  const has = (key: string) => result.design?.bom.some((l) => l.key === key);
  return {
    ...(s.pin && !has(s.pin) ? { pin: null } : {}),
    ...(s.hover?.key && !has(s.hover.key) ? { hover: null } : {}),
  };
}

let changeTimer: ReturnType<typeof setTimeout> | undefined;

/** The `lastChange` for an edit from `source` that moves the design from `prev` to `next`. */
function changeNote(source: ChangeSource, prev: DesignResult, next: DesignResult, note?: string): Pick<ViewStoreState, "lastChange"> {
  clearTimeout(changeTimer);
  // A problem on either side (no design) has its own message; there is nothing to compare.
  if (!prev.design || !next.design) return { lastChange: null };
  const id = (useView.getState().lastChange?.id ?? 0) + 1;
  changeTimer = setTimeout(() => {
    if (useView.getState().lastChange?.id === id) useView.setState({ lastChange: null });
  }, CHANGE_NOTE_MS);
  return { lastChange: { id, at: Date.now(), source, changes: diffDesigns(prev.design, next.design), ...(note ? { note } : {}) } };
}

/**
 * How the view reacts when the design changes: the one place the design reaches into how it is
 * shown. Subscribed once, below, to the design store's `designEvents`; the design store knows
 * nothing about it. Each case is one `set`, so the view is never half updated.
 */
function onEdit(edit: DesignEdit) {
  const s = useView.getState();
  const fit = { nonce: s.fit.nonce + 1, instant: false };
  switch (edit.type) {
    case "opened":
      // A new part or design: nothing carried over from the last one, and a fresh clock (a reopened crate has none).
      useView.setState({
        pin: null,
        hover: null,
        lastChange: null,
        designStartedAt: edit.restored ? null : Date.now(),
        designedInMs: null,
        fit,
      });
      break;
    case "edited": {
      const sizeChanged = edit.partReplaced || edit.next.design?.layout.key !== edit.prev.design?.layout.key;
      useView.setState({
        // With a source, records what moved; without one (a standards change) clears the note.
        ...(edit.source ? changeNote(edit.source, edit.prev, edit.next, edit.note) : { lastChange: null }),
        // "Designed in" times the design that was exported; an edit makes it stale, so it goes.
        ...(s.designedInMs !== null ? { designedInMs: null } : {}),
        hover: null,
        ...dropStaleLines({ pin: s.pin, hover: null }, edit.next),
        ...(sizeChanged ? { fit } : {}),
      });
      break;
    }
    case "refined":
      // Camera, layout pick and clock stay. A new cut list may have dropped a line the person pinned.
      useView.setState({ ...(edit.source ? changeNote(edit.source, edit.prev, edit.next) : {}), ...dropStaleLines(s, edit.next) });
      break;
    case "crate-switched":
      useView.setState({ pin: null, hover: null, fit });
      break;
  }
}
onDesignEdit(onEdit);
