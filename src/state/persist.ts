/**
 * The one way the app reads and writes `localStorage` (spec §9). The four storage modules
 * (standards, units, library, last design) are thin wrappers over `readJson` / `writeJson`;
 * they own their key, their format and their defaults, and nothing else.
 *
 * Contract for every save function: it never throws, and it returns `true` only if the value
 * is now stored. Missing storage (the server, or blocked by the browser) is a failed save.
 *
 * Where saves are triggered differs by module, and that is deliberate rather than tidy:
 * standards save inside their `useDesigner` actions, units inside `useView`'s, the library
 * inside its own store (`libraryStore.ts`), and the last design from an external debounced
 * subscriber (it changes on every edit and reads the whole design).
 */

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's localStorage, or null on the server or when it is blocked. */
export function browserStorage(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // e.g. storage disabled for the site
  }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Reads and parses `key`. A missing key, a missing store or a store that throws is "nothing
 * saved" and gives `fallback` silently. Text that `parse` rejects (or that makes it throw)
 * gives `fallback` with a console warning (`ignoredMessage` plus the reason), so bad data never
 * breaks the app.
 */
export function readJson<T>(
  store: KeyValueStore | null,
  key: string,
  parse: (text: string) => ParseResult<T>,
  fallback: T,
  ignoredMessage = "Saved data ignored.",
): T {
  let text: string | null = null;
  try {
    text = store?.getItem(key) ?? null;
  } catch {
    // Treated as nothing saved.
  }
  if (text === null) return fallback;
  try {
    const r = parse(text);
    if (r.ok) return r.value;
    console.warn(`${ignoredMessage} ${r.error}`);
  } catch (e) {
    console.warn(ignoredMessage, e);
  }
  return fallback;
}

/**
 * Stores already-serialised `text` under `key`, or removes the key when `text` is null (so a
 * default is saved as nothing). Returns false, never throws, when there is no store or it
 * refuses the write (blocked, quota); a refusal also warns with `failedMessage`.
 */
export function writeJson(store: KeyValueStore | null, key: string, text: string | null, failedMessage = "Couldn't save."): boolean {
  if (!store) return false;
  try {
    if (text === null) store.removeItem(key);
    else store.setItem(key, text);
    return true;
  } catch (e) {
    console.warn(failedMessage, e);
    return false;
  }
}
