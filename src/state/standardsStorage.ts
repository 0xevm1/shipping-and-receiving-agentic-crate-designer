import {
  DEFAULT_STANDARDS,
  sameStandards,
  standardsFromJson,
  standardsToJson,
  STANDARDS_VERSION,
  type ShopStandards,
} from "@/domain/standards";

/**
 * Shop standards survive reloads in `localStorage` (spec §9, §11). The key carries the
 * format version, so a future incompatible format starts from the defaults instead of
 * misreading old data.
 */
export const STANDARDS_STORAGE_KEY = `crate-designer.shop-standards.v${STANDARDS_VERSION}`;

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's localStorage, or null on the server or when it is blocked. */
function browserStorage(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // e.g. storage disabled for the site
  }
}

/**
 * The saved standards, or the defaults when nothing is saved. Anything unreadable or invalid
 * also gives the defaults, with a console warning, so bad data never breaks the app.
 */
export function loadStandards(storage: KeyValueStore | null = browserStorage()): ShopStandards {
  let text: string | null = null;
  try {
    text = storage?.getItem(STANDARDS_STORAGE_KEY) ?? null;
  } catch {
    // Treated as nothing saved.
  }
  if (text === null) return DEFAULT_STANDARDS;
  const r = standardsFromJson(text);
  if (r.ok) return r.standards;
  console.warn(`Saved shop standards ignored, using the defaults. ${r.error}`);
  return DEFAULT_STANDARDS;
}

/** Saves the standards; the defaults are saved as nothing, so a later change to them applies. */
export function saveStandards(standards: ShopStandards, storage: KeyValueStore | null = browserStorage()) {
  try {
    if (sameStandards(standards, DEFAULT_STANDARDS)) storage?.removeItem(STANDARDS_STORAGE_KEY);
    else storage?.setItem(STANDARDS_STORAGE_KEY, standardsToJson(standards));
  } catch (e) {
    console.warn("Couldn't save the shop standards.", e);
  }
}
