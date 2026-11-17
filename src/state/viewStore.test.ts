import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentMode, useView } from "./viewStore";
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

describe("view store: the 3D view", () => {
  beforeEach(() => useView.setState(initial, true));

  it("starts on the Overview tab, closed, with every toggle on and the iso camera", () => {
    expect(s().tab).toBe("overview");
    expect(s().view).toEqual({ lid: true, front: true, explode: 0, blocking: true, parts: true, dims: true, camera: "iso" });
    expect(currentMode(s().view)).toBe("closed");
  });

  it("setMode sets the lid, the front and the explode amount together, and asks for a re-frame", () => {
    const nonce = s().fit.nonce;
    s().setMode("open");
    expect(s().view).toMatchObject({ lid: false, front: false, explode: 0 });
    expect(currentMode(s().view)).toBe("open");
    s().setMode("exploded");
    expect(s().view).toMatchObject({ lid: true, front: true, explode: 1 });
    expect(currentMode(s().view)).toBe("exploded");
    expect(s().fit).toEqual({ nonce: nonce + 2, instant: false });
  });

  it("has no named mode for a half-exploded or mixed view", () => {
    s().setView({ explode: 0.4 });
    expect(currentMode(s().view)).toBeNull();
    s().setView({ explode: 0, lid: false });
    expect(currentMode(s().view)).toBeNull();
  });

  it("setView merges a patch without a re-frame", () => {
    const nonce = s().fit.nonce;
    s().setView({ camera: null, dims: false });
    expect(s().view).toMatchObject({ camera: null, dims: false, blocking: true });
    expect(s().fit.nonce).toBe(nonce);
  });

  it("setInsets re-frames instantly, and only when an inset moved", () => {
    const nonce = s().fit.nonce;
    s().setInsets({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(s().fit.nonce).toBe(nonce);
    s().setInsets({ left: 10, top: 0, right: 300, bottom: 0 });
    expect(s().fit).toEqual({ nonce: nonce + 1, instant: true });
  });

  it("requestFit bumps the nonce, instantly only when asked", () => {
    const nonce = s().fit.nonce;
    s().requestFit();
    expect(s().fit).toEqual({ nonce: nonce + 1, instant: false });
    s().requestFit(true);
    expect(s().fit).toEqual({ nonce: nonce + 2, instant: true });
  });
});

describe("view store: hover and pin", () => {
  beforeEach(() => useView.setState(initial, true));

  it("setHover ignores a hover equal to the current one, so the scene isn't re-picked for nothing", () => {
    const seen = vi.fn();
    const off = useView.subscribe(seen);
    s().setHover(null);
    expect(seen).not.toHaveBeenCalled();
    s().setHover({ key: "a", source: "3d" });
    s().setHover({ key: "a", source: "3d" });
    expect(seen).toHaveBeenCalledTimes(1);
    s().setHover({ key: "a", source: "list" });
    s().setHover({ assembly: "lid", source: "list" });
    expect(seen).toHaveBeenCalledTimes(3);
    s().setHover(null);
    expect(s().hover).toBeNull();
    off();
  });

  it("pins and unpins a line", () => {
    s().setPin("a");
    expect(s().pin).toBe("a");
    s().setPin(null);
    expect(s().pin).toBeNull();
  });
});

describe("view store: time to design", () => {
  beforeEach(() => useView.setState(initial, true));

  it("runs from the clock start to the first export only", () => {
    expect(s().designStartedAt).toBeNull();
    s().markExported(5000); // before the clock starts: nothing to record
    expect(s().designedInMs).toBeNull();
    s().startDesignClock(1000);
    s().startDesignClock(2000); // already running
    expect(s().designStartedAt).toBe(1000);
    s().markExported(73_000);
    expect(s().designedInMs).toBe(72_000);
    s().markExported(90_000); // later exports don't move it
    expect(s().designedInMs).toBe(72_000);
  });

  it("never records a negative time", () => {
    s().startDesignClock(5000);
    s().markExported(1000);
    expect(s().designedInMs).toBe(0);
  });
});
