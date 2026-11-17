import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parts } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { parseDesignFile, serializeDesign, type DesignFile, type DesignFilePart } from "@/domain/designFile";
import { LIBRARY_KIND, libraryToJson, partKey } from "@/domain/designLibrary";
import { LIBRARY_STORAGE_KEY, loadLibrary, saveLibrary } from "./libraryStorage";
import { useLibrary } from "./libraryStore";

/** An in-memory Storage, standing in for the browser's localStorage. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function filePart(id: string): DesignFilePart {
  const p = parts.find((x) => x.id === id)!;
  return { source: "catalog", id: p.id, name: p.name, material: p.material, mass_kg: p.mass_kg, dimensions_mm: p.dimensions_mm, model: p.model };
}

function designText(part: DesignFilePart, quantity = 4) {
  const settings = { ...DEFAULT_SETTINGS, quantity };
  const design = computeDesign(part, settings).design!;
  return serializeDesign({ part, settings, layoutKey: design.layout.key, design, savedAt: "2026-11-16T12:00:00.000Z" });
}
const designFile = (part: DesignFilePart, quantity = 4): DesignFile => {
  const r = parseDesignFile(designText(part, quantity));
  if (!r.ok) throw new Error(r.error);
  return r.file;
};

const bracket = filePart("PART-001");
const shaft = filePart("PART-002");
const lib = () => useLibrary.getState();

describe("library storage (#14)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses a versioned key", () => {
    expect(LIBRARY_STORAGE_KEY).toBe("crate-designer.design-library.v1");
  });

  it("is empty when nothing is saved, and stores nothing for an empty library", () => {
    const store = memoryStorage();
    expect(loadLibrary(store)).toEqual([]);
    store.setItem(LIBRARY_STORAGE_KEY, "old");
    saveLibrary([], store);
    expect(store.data.size).toBe(0);
  });

  it.each([
    ["unreadable JSON", "{nope"],
    ["another kind", JSON.stringify({ kind: "x", version: 1, entries: [] })],
    ["a newer version", JSON.stringify({ kind: LIBRARY_KIND, version: 99, entries: [] })],
  ])("falls back to empty with a warning for %s", (_, text) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStorage();
    store.setItem(LIBRARY_STORAGE_KEY, text);
    expect(loadLibrary(store)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps the good entries when some are bad, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStorage();
    const json = JSON.parse(
      libraryToJson([{ id: "a", name: "A", notes: "", savedAt: "2026-01-01", partKey: partKey(bracket), design: designFile(bracket) }]),
    );
    json.entries.push({ id: "b", name: "B", savedAt: "x", design: { kind: "crate-design", schemaVersion: 1 } });
    store.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(json));
    expect(loadLibrary(store).map((e) => e.id)).toEqual(["a"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("survives storage that throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadLibrary(broken)).toEqual([]);
    expect(saveLibrary([], broken)).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(loadLibrary(null)).toEqual([]);
  });

  it("reports a failed save when storage is unavailable or throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const entry = { id: "a", name: "A", notes: "", savedAt: "2026-01-01", partKey: partKey(bracket), design: designFile(bracket) };
    expect(saveLibrary([entry], null)).toBe(false);
    expect(saveLibrary([], null)).toBe(false);
    const full = { ...memoryStorage(), setItem: () => { throw new Error("quota"); } };
    expect(saveLibrary([entry], full)).toBe(false);
    expect(saveLibrary([entry], memoryStorage())).toBe(true);
  });
});

describe("useLibrary (#14)", () => {
  let store: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    store = memoryStorage();
    lib().load(store);
  });

  it("saves a design under its part and keeps it across a reload", () => {
    expect(lib().save(designFile(bracket), "Bracket x4", "Proven on the Acme order")).toBeNull();
    expect(lib().save(designFile(shaft, 8), "Shaft x8")).toBeNull();
    expect(store.data.has(LIBRARY_STORAGE_KEY)).toBe(true);
    // A fresh load (a reload) reads the same entries back.
    useLibrary.setState({ entries: [] });
    lib().load(store);
    expect(lib().entries).toHaveLength(2);
    const forBracket = lib().forPart(partKey(bracket));
    expect(forBracket).toHaveLength(1);
    expect(forBracket[0]).toMatchObject({ name: "Bracket x4", notes: "Proven on the Acme order" });
    expect(forBracket[0].design.summary.quantity).toBe(4);
    expect(lib().forPart(partKey(shaft))[0].design.settings.quantity).toBe(8);
  });

  it("needs a name", () => {
    expect(lib().save(designFile(bracket), "  ")).toBe("Give the design a name.");
    expect(lib().entries).toHaveLength(0);
  });

  it("renames, deletes and undoes the delete, saving each time", () => {
    lib().save(designFile(bracket), "First");
    const id = lib().entries[0].id;
    expect(lib().rename(id, "Renamed")).toBeNull();
    expect(loadLibrary(store)[0].name).toBe("Renamed");
    const removed = lib().remove(id)!;
    expect(lib().entries).toHaveLength(0);
    expect(store.data.has(LIBRARY_STORAGE_KEY)).toBe(false);
    lib().undoRemove(removed);
    expect(loadLibrary(store).map((e) => e.name)).toEqual(["Renamed"]);
  });

  it("exports and imports the library file, skipping duplicates and bad entries", () => {
    lib().save(designFile(bracket), "Bracket");
    const text = lib().exportJson();
    expect(JSON.parse(text).kind).toBe(LIBRARY_KIND);
    // Import into an empty library on "another machine".
    lib().load(memoryStorage());
    expect(lib().importJson(text)).toBe("Imported 1 design.");
    expect(lib().importJson(text)).toBe("No new designs: 1 already saved.");
    const json = JSON.parse(text);
    json.entries[0].id = "other";
    json.entries.push({ id: "bad" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(lib().importJson(JSON.stringify(json))).toBe("Imported 1 design. 1 entry couldn't be read and was skipped.");
    expect(lib().importJson("{nope")).toBe("This library file is not valid JSON.");
    expect(lib().entries).toHaveLength(2);
  });

  describe("when the browser refuses to store", () => {
    const FAILED = "Saved for now, but this browser refused to store it (storage full or blocked).";
    beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

    it("save, rename, remove and undo all report it, with null storage", () => {
      lib().load(null);
      expect(lib().save(designFile(bracket), "First")).toBe(FAILED);
      expect(lib().entries).toHaveLength(1); // kept in memory for this session
      const id = lib().entries[0].id;
      expect(lib().rename(id, "Renamed")).toBe(FAILED);
      const removed = lib().remove(id)!;
      expect(removed.saveError).toBe(FAILED);
      expect(lib().undoRemove(removed)).toBe(FAILED);
      expect(lib().entries.map((e) => e.name)).toEqual(["Renamed"]);
    });

    it("remove and undo report a throwing store; a working store reports null", () => {
      lib().save(designFile(bracket), "First");
      const id = lib().entries[0].id;
      const setItem = vi.spyOn(store, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      const removeItem = vi.spyOn(store, "removeItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const removed = lib().remove(id)!;
      expect(removed.saveError).toBe(FAILED);
      expect(lib().undoRemove(removed)).toBe(FAILED);
      setItem.mockRestore();
      removeItem.mockRestore();
      const again = lib().remove(id)!;
      expect(again.saveError).toBeNull();
      expect(lib().undoRemove(again)).toBeNull();
    });

    it("remove of an unknown id is null", () => {
      expect(lib().remove("nope")).toBeNull();
    });
  });
});
