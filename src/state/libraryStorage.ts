import { LIBRARY_VERSION, libraryToJson, parseLibrary, type SavedDesign } from "@/domain/designLibrary";
import { browserStorage, type KeyValueStore } from "./standardsStorage";

/**
 * The design library (#14) survives reloads in `localStorage` (spec §9), in the same envelope
 * as the exported library file. The key carries the format version, like the shop standards.
 */
export const LIBRARY_STORAGE_KEY = `crate-designer.design-library.v${LIBRARY_VERSION}`;

/**
 * The saved designs, or none. Unreadable data gives an empty library and bad entries are
 * skipped, each with a console warning, so bad data never breaks the app.
 */
export function loadLibrary(storage: KeyValueStore | null = browserStorage()): SavedDesign[] {
  let text: string | null = null;
  try {
    text = storage?.getItem(LIBRARY_STORAGE_KEY) ?? null;
  } catch {
    // Treated as nothing saved.
  }
  if (text === null) return [];
  const r = parseLibrary(text);
  if (!r.ok) {
    console.warn(`Saved design library ignored. ${r.error}`);
    return [];
  }
  if (r.skipped.length) console.warn(`Skipped ${r.skipped.length} saved design(s) that couldn't be read.`, r.skipped);
  return r.entries;
}

/** Saves the library (an empty one as nothing). False when storage refused it (e.g. quota). */
export function saveLibrary(entries: SavedDesign[], storage: KeyValueStore | null = browserStorage()): boolean {
  try {
    if (!entries.length) storage?.removeItem(LIBRARY_STORAGE_KEY);
    else storage?.setItem(LIBRARY_STORAGE_KEY, libraryToJson(entries));
    return true;
  } catch (e) {
    console.warn("Couldn't save the design library.", e);
    return false;
  }
}
