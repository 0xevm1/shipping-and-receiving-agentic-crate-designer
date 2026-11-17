import { create } from "zustand";
import type { DesignFile } from "@/domain/designFile";
import {
  createEntry,
  entriesForPart,
  libraryToJson,
  mergeEntries,
  parseLibrary,
  removeEntry,
  renameEntry,
  restoreEntry,
  type Removed,
  type SavedDesign,
} from "@/domain/designLibrary";
import { loadLibrary, saveLibrary } from "./libraryStorage";
import { browserStorage, type KeyValueStore } from "./standardsStorage";

/**
 * The design library (#14): saved designs per part, kept in localStorage. Its own small store,
 * separate from the designer, because nothing in the crate depends on it; reusing a design goes
 * through the same path as opening a design file (`useOpenDesign`).
 */
export interface LibraryState {
  entries: SavedDesign[];
  /** Where the library is saved: the browser's localStorage, or a stand-in in tests. */
  storage: KeyValueStore | null;
  /**
   * A shared custom-part design waiting for its GLB (a share link can't carry the model). Loading
   * a file with that name opens the design.
   */
  pendingShare: DesignFile | null;

  /** Reads the library saved in this browser. Called once after the app mounts. */
  load: (storage?: KeyValueStore | null) => void;
  /** Saves a design under a name; returns an error message, or null. */
  save: (design: DesignFile, name: string, notes?: string) => string | null;
  rename: (id: string, name: string) => string | null;
  /** Deletes a design and returns what an undo needs, plus `saveError` when the change couldn't be stored. Null if there is no such design. */
  remove: (id: string) => (Removed & { saveError: string | null }) | null;
  /** Puts a deleted design back; returns an error message if the change couldn't be stored, or null. */
  undoRemove: (removed: Removed) => string | null;
  /** The part's saved designs, newest first. */
  forPart: (key: string) => SavedDesign[];
  exportJson: () => string;
  /** Merges a library file; returns a sentence saying what happened. */
  importJson: (text: string) => string;
  setPendingShare: (file: DesignFile | null) => void;
}

const STORAGE_FAILED = "Saved for now, but this browser refused to store it (storage full or blocked).";

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // randomUUID needs a secure context; plain http on a LAN IP doesn't have one.
    return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const useLibrary = create<LibraryState>()((set, get) => {
  const commit = (entries: SavedDesign[]): string | null => {
    set({ entries });
    return saveLibrary(entries, get().storage) ? null : STORAGE_FAILED;
  };

  return {
    entries: [],
    storage: null,
    pendingShare: null,

    load: (storage = browserStorage()) => set({ storage, entries: loadLibrary(storage) }),
    save: (design, name, notes = "") => {
      const r = createEntry({ id: newId(), name, notes, savedAt: new Date().toISOString(), design });
      if (!r.ok) return r.error;
      return commit([r.entry, ...get().entries]);
    },
    rename: (id, name) => {
      const r = renameEntry(get().entries, id, name);
      if (!r.ok) return r.error;
      return commit(r.entries);
    },
    remove: (id) => {
      const r = removeEntry(get().entries, id);
      return r && { ...r, saveError: commit(r.entries) };
    },
    undoRemove: (removed) => commit(restoreEntry(get().entries, removed.removed, removed.index)),
    forPart: (key) => entriesForPart(get().entries, key),
    exportJson: () => libraryToJson(get().entries),
    importJson: (text) => {
      const r = parseLibrary(text);
      if (!r.ok) return r.error;
      const m = mergeEntries(get().entries, r.entries);
      const failed = m.added ? commit(m.entries) : null;
      const parts = [m.added ? `Imported ${plural(m.added, "design")}.` : `No new designs: ${m.duplicates} already saved.`];
      if (m.added && m.duplicates) parts.push(`${m.duplicates} already saved.`);
      if (r.skipped.length) {
        console.warn("Skipped library entries:", r.skipped);
        parts.push(`${plural(r.skipped.length, "entry", "entries")} couldn't be read and ${r.skipped.length === 1 ? "was" : "were"} skipped.`);
      }
      if (failed) parts.push(failed);
      return parts.join(" ");
    },
    setPendingShare: (pendingShare) => set({ pendingShare }),
  };
});
