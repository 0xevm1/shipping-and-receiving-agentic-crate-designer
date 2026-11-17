import { DEFAULT_STANDARDS, sameStandards, standardsFromJson, standardsToJson, STANDARDS_VERSION, type ShopStandards } from "@/domain/standards";
import { browserStorage, readJson, writeJson, type KeyValueStore } from "./persist";

// Re-exported for existing importers; the primitives live in `persist.ts`.
export { browserStorage, type KeyValueStore };

/**
 * Shop standards survive reloads in `localStorage` (spec §9, §11). The key carries the
 * format version, so a future incompatible format starts from the defaults instead of
 * misreading old data.
 */
export const STANDARDS_STORAGE_KEY = `crate-designer.shop-standards.v${STANDARDS_VERSION}`;

/**
 * The saved standards, or the defaults when nothing is saved. Anything unreadable or invalid
 * also gives the defaults, with a console warning, so bad data never breaks the app.
 */
export function loadStandards(storage: KeyValueStore | null = browserStorage()): ShopStandards {
  return readJson(
    storage,
    STANDARDS_STORAGE_KEY,
    (text) => {
      const r = standardsFromJson(text);
      return r.ok ? { ok: true, value: r.standards } : r;
    },
    DEFAULT_STANDARDS,
    "Saved shop standards ignored, using the defaults.",
  );
}

/**
 * Saves the standards; the defaults are saved as nothing, so a later change to them applies.
 * False when storage is missing or refused it.
 */
export function saveStandards(standards: ShopStandards, storage: KeyValueStore | null = browserStorage()): boolean {
  const text = sameStandards(standards, DEFAULT_STANDARDS) ? null : standardsToJson(standards);
  return writeJson(storage, STANDARDS_STORAGE_KEY, text, "Couldn't save the shop standards.");
}
