import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLastGlb, GLB_DB_NAME, GLB_STORE, loadLastGlb, MAX_CACHED_GLB_BYTES, saveLastGlb } from "./glbCache";

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill).buffer;

/** Writes a raw value as the record, as old or tampered data would be. */
async function putRaw(idb: IDBFactory, value: unknown) {
  await saveLastGlb("seed.glb", bytes(4), idb);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(GLB_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GLB_STORE, "readwrite");
    tx.objectStore(GLB_STORE).put(value, "last");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("last custom GLB in IndexedDB (#71)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps one record: the last GLB saved", async () => {
    const idb = new IDBFactory();
    expect(await loadLastGlb(idb)).toBeNull();
    expect(await saveLastGlb("a.glb", bytes(10, 1), idb)).toBe("saved");
    expect(await saveLastGlb("b.glb", bytes(20, 2), idb)).toBe("saved");
    const got = await loadLastGlb(idb);
    expect(got?.name).toBe("b.glb");
    expect(new Uint8Array(got!.bytes)).toEqual(new Uint8Array(20).fill(2));
    await clearLastGlb(idb);
    expect(await loadLastGlb(idb)).toBeNull();
  });

  it("does not cache a file over the 50 MB cap, and drops the older one", async () => {
    const idb = new IDBFactory();
    expect(MAX_CACHED_GLB_BYTES).toBe(50 * 1024 * 1024);
    await saveLastGlb("a.glb", bytes(10), idb);
    expect(await saveLastGlb("huge.glb", { byteLength: MAX_CACHED_GLB_BYTES + 1 } as ArrayBuffer, idb)).toBe("too-big");
    expect(await loadLastGlb(idb)).toBeNull();
  });

  it("treats a bad record as nothing saved, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of [null, "text", { name: "x.glb" }, { name: 3, bytes: bytes(4) }, { name: "x.glb", bytes: "nope" }]) {
      const idb = new IDBFactory();
      await putRaw(idb, value);
      expect(await loadLastGlb(idb)).toBeNull();
    }
    expect(warn).toHaveBeenCalled();
  });

  it("IndexedDB being unavailable is not an error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadLastGlb(null)).toBeNull();
    expect(await saveLastGlb("a.glb", bytes(4), null)).toBe("unavailable");
    const broken = {
      open: () => {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    expect(await loadLastGlb(broken)).toBeNull();
    expect(await saveLastGlb("a.glb", bytes(4), broken)).toBe("unavailable");
    await expect(clearLastGlb(broken)).resolves.toBeUndefined();
  });
});
