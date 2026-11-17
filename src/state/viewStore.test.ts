import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useView } from "./viewStore";
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

const initial = useView.getState();
const s = () => useView.getState();

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

describe("view store units", () => {
  beforeEach(() => useView.setState(initial, true));

  it("setUnits saves the choice and loadSavedUnits applies it", () => {
    const store = memoryStorage();
    s().setUnits("metric", store);
    expect(s().units).toBe("metric");
    expect(loadUnits(store)).toBe("metric");

    useView.setState(initial, true);
    expect(s().units).toBe("imperial");
    s().loadSavedUnits(store);
    expect(s().units).toBe("metric");
  });

  it("loadSavedUnits keeps the default when nothing is saved", () => {
    s().loadSavedUnits(memoryStorage());
    expect(s().units).toBe("imperial");
  });
});

describe("view store leaf state", () => {
  beforeEach(() => useView.setState(initial, true));

  it("starts with the panels shown, the drawer closed and no message or tooltip", () => {
    expect(s()).toMatchObject({ panelsHidden: false, drawerOpen: false, restoring: false, loadMessage: "", loadMessageKind: "note", tooltip: null });
  });

  it("toggles the panels", () => {
    s().togglePanels();
    expect(s().panelsHidden).toBe(true);
    s().togglePanels();
    expect(s().panelsHidden).toBe(false);
  });

  it("a load message is a note unless it says it is an error", () => {
    s().setLoadMessage("Loaded.");
    expect(s()).toMatchObject({ loadMessage: "Loaded.", loadMessageKind: "note" });
    s().setLoadMessage("Broken.", "error");
    expect(s()).toMatchObject({ loadMessage: "Broken.", loadMessageKind: "error" });
    s().setLoadMessage("");
    expect(s().loadMessage).toBe("");
  });

  it("does not notify when the drawer or the restoring flag is set to what it already is", () => {
    const seen = vi.fn();
    const off = useView.subscribe(seen);
    s().setDrawerOpen(false);
    s().setRestoring(false);
    expect(seen).not.toHaveBeenCalled();
    s().setDrawerOpen(true);
    s().setRestoring(true);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });
});
