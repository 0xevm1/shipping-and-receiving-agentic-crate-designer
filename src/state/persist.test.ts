import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { LAST_DESIGN_STORAGE_KEY, loadLastDesign, saveLastDesign } from "./lastDesignStorage";
import { LIBRARY_STORAGE_KEY, loadLibrary, saveLibrary } from "./libraryStorage";
import { readJson, writeJson, type KeyValueStore } from "./persist";
import { loadStandards, saveStandards, STANDARDS_STORAGE_KEY } from "./standardsStorage";
import { loadUnits, saveUnits, UNITS_STORAGE_KEY } from "./unitsStorage";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing: KeyValueStore = {
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

const text = (r: string) => ({ ok: true as const, value: r });
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

afterEach(() => vi.restoreAllMocks());

describe("readJson", () => {
  it("gives the fallback, silently, for a missing key, no store or a throwing store", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readJson(memoryStorage(), "k", text, "fb")).toBe("fb");
    expect(readJson(null, "k", text, "fb")).toBe("fb");
    expect(readJson(throwing, "k", text, "fb")).toBe("fb");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the parsed value", () => {
    const store = memoryStorage();
    store.setItem("k", "hello");
    expect(readJson(store, "k", text, "fb")).toBe("hello");
  });

  it("warns and falls back when the parser rejects or throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStorage();
    store.setItem("k", "bad");
    expect(readJson(store, "k", () => ({ ok: false, error: "Nope." }), "fb", "Ignored.")).toBe("fb");
    expect(warn).toHaveBeenLastCalledWith("Ignored. Nope.");
    expect(
      readJson(
        store,
        "k",
        () => {
          throw new Error("boom");
        },
        "fb",
      ),
    ).toBe("fb");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("writeJson", () => {
  it("stores text, and removes the key for null", () => {
    const store = memoryStorage();
    expect(writeJson(store, "k", "v")).toBe(true);
    expect(store.data.get("k")).toBe("v");
    expect(writeJson(store, "k", null)).toBe(true);
    expect(store.data.has("k")).toBe(false);
  });

  it("returns false with no store, quietly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(writeJson(null, "k", "v")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns false and warns when the store throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(writeJson(throwing, "k", "v", "Couldn't.")).toBe(false);
    expect(writeJson(throwing, "k", null)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("every save function reports whether the value is stored", () => {
  it("is false for null and throwing storage, true for working storage", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const standards = { ...DEFAULT_STANDARDS, defaults: { ...DEFAULT_STANDARDS.defaults, maxLayers: 2 } };
    const last = loadLastDesign(memoryStorageWith(LAST_DESIGN_STORAGE_KEY, fixture("last-design.v1.json")))!;
    for (const save of [
      (s: KeyValueStore | null) => saveStandards(standards, s),
      (s: KeyValueStore | null) => saveUnits("metric", s),
      (s: KeyValueStore | null) => saveLibrary(loadLibrary(memoryStorageWith(LIBRARY_STORAGE_KEY, fixture("design-library.v1.json"))), s),
      (s: KeyValueStore | null) => saveLastDesign(last, s),
    ]) {
      expect(save(null)).toBe(false);
      expect(save(throwing)).toBe(false);
      expect(save(memoryStorage())).toBe(true);
    }
  });
});

function memoryStorageWith(key: string, value: string) {
  const s = memoryStorage();
  s.setItem(key, value);
  return s;
}

/**
 * Compatibility: these fixtures are the text the app stored before the persistence helper
 * existed. They must keep loading, and the keys must not change, or users lose saved data.
 */
describe("stored data from before persist.ts still loads", () => {
  it("shop standards (crate-designer.shop-standards.v1)", () => {
    expect(STANDARDS_STORAGE_KEY).toBe("crate-designer.shop-standards.v1");
    const loaded = loadStandards(memoryStorageWith(STANDARDS_STORAGE_KEY, fixture("shop-standards.v1.json")));
    expect(loaded.defaults.maxLayers).toBe(3);
    expect(loaded.stock.floorPlywoodMm).toBe(19);
    // Saving what was loaded writes the same stored text back.
    const store = memoryStorage();
    expect(saveStandards(loaded, store)).toBe(true);
    expect(store.data.get(STANDARDS_STORAGE_KEY)).toBe(fixture("shop-standards.v1.json"));
  });

  it("units (crate-designer.units.v1) are the bare word", () => {
    expect(UNITS_STORAGE_KEY).toBe("crate-designer.units.v1");
    expect(loadUnits(memoryStorageWith(UNITS_STORAGE_KEY, "metric"))).toBe("metric");
    expect(loadUnits(memoryStorageWith(UNITS_STORAGE_KEY, "imperial"))).toBe("imperial");
    const store = memoryStorage();
    saveUnits("metric", store);
    expect(store.data.get(UNITS_STORAGE_KEY)).toBe("metric");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadUnits(memoryStorageWith(UNITS_STORAGE_KEY, "furlongs"))).toBeNull();
  });

  it("design library (crate-designer.design-library.v1)", () => {
    expect(LIBRARY_STORAGE_KEY).toBe("crate-designer.design-library.v1");
    const entries = loadLibrary(memoryStorageWith(LIBRARY_STORAGE_KEY, fixture("design-library.v1.json")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "fixture-1", name: "Bracket x4", notes: "Proven on the Acme order" });
    expect(entries[0].design.part.id).toBe("PART-001");
  });

  it("last design (crate-designer.last-design.v1)", () => {
    expect(LAST_DESIGN_STORAGE_KEY).toBe("crate-designer.last-design.v1");
    const last = loadLastDesign(memoryStorageWith(LAST_DESIGN_STORAGE_KEY, fixture("last-design.v1.json")));
    expect(last).toMatchObject({ tab: "rules", ranking: "cost" });
    expect(last?.design.part.id).toBe("PART-001");
  });
});

/** The design inside the last-design entry is versioned on its own (#105 moved it to format 3). */
describe("last designs saved before and after the part's units and up axis (#105)", () => {
  const read = (name: string) => loadLastDesign(memoryStorageWith(LAST_DESIGN_STORAGE_KEY, fixture(name)));

  it("a format 2 design (no units, no axis) opens as Z up with its units left to find", () => {
    const last = read("last-design.v1.design-v2.json");
    expect(last).toMatchObject({ tab: "layouts", ranking: "volume" });
    expect(last?.design.schemaVersion).toBe(3);
    expect(last?.design.part).toMatchObject({ id: "bracket-inches", up: "z" });
    expect(last?.design.part.units).toBeUndefined();
  });

  it("a format 3 design keeps its units and axis", () => {
    const last = read("last-design.v1.design-v3.json");
    expect(last?.design.part).toMatchObject({ id: "bracket-y-up", units: "m", up: "y" });
  });

  it("saving what was loaded writes the current format, and it loads again the same", () => {
    const store = memoryStorage();
    for (const name of ["last-design.v1.design-v2.json", "last-design.v1.design-v3.json"]) {
      const last = read(name)!;
      expect(saveLastDesign(last, store)).toBe(true);
      expect(JSON.parse(store.data.get(LAST_DESIGN_STORAGE_KEY)!).design.schemaVersion).toBe(3);
      expect(loadLastDesign(store)).toEqual(last);
    }
  });
});
