import { LIBRARY_VERSION, libraryToJson, parseLibrary, type SavedDesign } from "@/domain/designLibrary";
import { browserStorage, readJson, writeJson, type KeyValueStore } from "./persist";

/**
 * The design library survives reloads in `localStorage` (spec §9), in the same envelope as the
 * exported library file. The key carries the format version, like the shop standards.
 */
export const LIBRARY_STORAGE_KEY = `crate-designer.design-library.v${LIBRARY_VERSION}`;

/**
 * The saved designs, or none. Unreadable data gives an empty library and bad entries are
 * skipped, each with a console warning, so bad data never breaks the app.
 */
export function loadLibrary(storage: KeyValueStore | null = browserStorage()): SavedDesign[] {
  return readJson<SavedDesign[]>(
    storage,
    LIBRARY_STORAGE_KEY,
    (text) => {
      const r = parseLibrary(text);
      if (!r.ok) return r;
      if (r.skipped.length) console.warn(`Skipped ${r.skipped.length} saved design(s) that couldn't be read.`, r.skipped);
      return { ok: true, value: r.entries };
    },
    [],
    "Saved design library ignored.",
  );
}

/** Saves the library (an empty one as nothing). False when storage is missing or refused it (e.g. quota). */
export function saveLibrary(entries: SavedDesign[], storage: KeyValueStore | null = browserStorage()): boolean {
  return writeJson(storage, LIBRARY_STORAGE_KEY, entries.length ? libraryToJson(entries) : null, "Couldn't save the design library.");
}
