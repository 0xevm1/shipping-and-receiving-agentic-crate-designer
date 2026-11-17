/**
 * The last custom GLB's bytes, kept in IndexedDB (#71, spec §9) so the last-opened crate can
 * reopen a loaded part after a reload: its object URL dies with the page. One record (the last
 * custom GLB saved replaces it), and nothing over `MAX_CACHED_GLB_BYTES`. Everything here is
 * best effort: IndexedDB being missing, blocked or full is never an error.
 */
export const GLB_DB_NAME = "crate-designer";
export const GLB_STORE = "glb";
const GLB_DB_VERSION = 1;
const RECORD_KEY = "last";
export const MAX_CACHED_GLB_BYTES = 50 * 1024 * 1024;

export interface CachedGlb {
  name: string;
  bytes: ArrayBuffer;
  savedAt: string;
}

/** The browser's IndexedDB, or null on the server or when it is blocked. */
export function browserIdb(): IDBFactory | null {
  try {
    return typeof indexedDB !== "undefined" ? indexedDB : null;
  } catch {
    return null;
  }
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function open(idb: IDBFactory): Promise<IDBDatabase> {
  const req = idb.open(GLB_DB_NAME, GLB_DB_VERSION);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(GLB_STORE)) req.result.createObjectStore(GLB_STORE);
  };
  return done(req);
}

/** Runs one request in a transaction on the store and closes the database. */
async function withStore<T>(idb: IDBFactory, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open(idb);
  try {
    const tx = db.transaction(GLB_STORE, mode);
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    const [result] = await Promise.all([done(run(tx.objectStore(GLB_STORE))), finished]);
    return result;
  } finally {
    db.close();
  }
}

/**
 * Keeps `bytes` as the last custom GLB. A file over the cap isn't kept, and the older record
 * is dropped so it can't be mistaken for this one.
 */
export async function saveLastGlb(
  name: string,
  bytes: ArrayBuffer,
  idb: IDBFactory | null = browserIdb(),
): Promise<"saved" | "too-big" | "unavailable"> {
  if (!idb) return "unavailable";
  try {
    if (bytes.byteLength > MAX_CACHED_GLB_BYTES) {
      await withStore(idb, "readwrite", (s) => s.delete(RECORD_KEY));
      return "too-big";
    }
    const record: CachedGlb = { name, bytes, savedAt: new Date().toISOString() };
    await withStore(idb, "readwrite", (s) => s.put(record, RECORD_KEY));
    return "saved";
  } catch (e) {
    console.warn("Couldn't keep the part's model in this browser.", e);
    return "unavailable";
  }
}

/** The last custom GLB, or null when there is none, it is unreadable, or IndexedDB is unavailable. */
export async function loadLastGlb(idb: IDBFactory | null = browserIdb()): Promise<CachedGlb | null> {
  if (!idb) return null;
  let value: unknown;
  try {
    value = await withStore(idb, "readonly", (s) => s.get(RECORD_KEY));
  } catch (e) {
    console.warn("Couldn't read the kept model.", e);
    return null;
  }
  if (value === undefined) return null;
  const r = value as Partial<CachedGlb> | null;
  if (!r || typeof r !== "object" || typeof r.name !== "string" || !(r.bytes instanceof ArrayBuffer)) {
    console.warn("The kept model's record is unreadable and was ignored.");
    return null;
  }
  return { name: r.name, bytes: r.bytes, savedAt: typeof r.savedAt === "string" ? r.savedAt : "" };
}

export async function clearLastGlb(idb: IDBFactory | null = browserIdb()): Promise<void> {
  if (!idb) return;
  try {
    await withStore(idb, "readwrite", (s) => s.delete(RECORD_KEY));
  } catch {
    // Nothing to do.
  }
}
