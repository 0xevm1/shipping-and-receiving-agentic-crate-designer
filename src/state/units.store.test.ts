import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesigner } from "./store";
import { DEFAULT_UNITS, loadUnits, saveUnits, UNITS_STORAGE_KEY } from "./unitsStorage";

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

const initial = useDesigner.getState();
const s = () => useDesigner.getState();

describe("units persistence", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defaults to imperial for a US shop floor", () => {
    expect(DEFAULT_UNITS).toBe("imperial");
    expect(initial.units).toBe("imperial");
  });

  it("round-trips the choice under a versioned key", () => {
    const store = memoryStorage();
    expect(UNITS_STORAGE_KEY).toBe("crate-designer.units.v1");
    saveUnits("metric", store);
    expect(store.data.get(UNITS_STORAGE_KEY)).toBe("metric");
    expect(loadUnits(store)).toBe("metric");
    saveUnits("imperial", store);
    expect(loadUnits(store)).toBe("imperial");
  });

  it("gives null when nothing is saved", () => {
    expect(loadUnits(memoryStorage())).toBeNull();
  });

  it("ignores an unknown value with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStorage();
    store.setItem(UNITS_STORAGE_KEY, "furlongs");
    expect(loadUnits(store)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadUnits(broken)).toBeNull();
    expect(() => saveUnits("metric", broken)).not.toThrow();
  });

  it("is a no-op on the server (no window)", () => {
    expect(loadUnits()).toBeNull();
    expect(() => saveUnits("metric")).not.toThrow();
  });
});

describe("store units", () => {
  beforeEach(() => useDesigner.setState(initial, true));

  it("setUnits saves the choice and loadSavedUnits applies it", () => {
    const store = memoryStorage();
    s().setUnits("metric", store);
    expect(s().units).toBe("metric");
    expect(loadUnits(store)).toBe("metric");

    useDesigner.setState(initial, true);
    expect(s().units).toBe("imperial");
    s().loadSavedUnits(store);
    expect(s().units).toBe("metric");
  });

  it("loadSavedUnits keeps the default when nothing is saved", () => {
    s().loadSavedUnits(memoryStorage());
    expect(s().units).toBe("imperial");
  });
});
