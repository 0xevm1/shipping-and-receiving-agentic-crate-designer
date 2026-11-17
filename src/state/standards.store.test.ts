import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STANDARDS, mergeStandards, sameStandards, standardsToJson, type ShopStandards } from "@/domain/standards";
import { useDesigner } from "./store";
import { loadStandards, saveStandards, STANDARDS_STORAGE_KEY } from "./standardsStorage";

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

describe("standards persistence", () => {
  afterEach(() => vi.restoreAllMocks());

  it("round-trips through storage under a versioned key", () => {
    const store = memoryStorage();
    const custom = mergeStandards(DEFAULT_STANDARDS, { rates: { costUsdPerM3: { plywood: 2200 } } }) as ShopStandards;
    saveStandards(custom, store);
    expect(STANDARDS_STORAGE_KEY).toMatch(/\.v1$/);
    expect(store.data.has(STANDARDS_STORAGE_KEY)).toBe(true);
    expect(sameStandards(loadStandards(store), custom)).toBe(true);
  });

  it("stores nothing for the defaults", () => {
    const store = memoryStorage();
    store.setItem(STANDARDS_STORAGE_KEY, "old");
    saveStandards(DEFAULT_STANDARDS, store);
    expect(store.data.size).toBe(0);
    expect(loadStandards(store)).toBe(DEFAULT_STANDARDS);
  });

  it.each([
    ["not JSON", "{nope"],
    ["an out-of-range value", standardsToJson({ ...DEFAULT_STANDARDS, limits: { ...DEFAULT_STANDARDS.limits, stackKg: -1 } })],
    ["another version", JSON.stringify({ version: 2, standards: {} })],
  ])("falls back to the defaults with a warning for %s", (_, text) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStorage();
    store.setItem(STANDARDS_STORAGE_KEY, text);
    expect(loadStandards(store)).toBe(DEFAULT_STANDARDS);
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
    expect(loadStandards(broken)).toBe(DEFAULT_STANDARDS);
    expect(() => saveStandards({ ...DEFAULT_STANDARDS, stock: { ...DEFAULT_STANDARDS.stock, floorPlywoodMm: 25 } }, broken)).not.toThrow();
  });

  it("is a no-op on the server (no window)", () => {
    expect(loadStandards()).toBe(DEFAULT_STANDARDS);
  });
});

describe("store standards", () => {
  beforeEach(() => useDesigner.setState(initial, true));

  it("starts on the defaults", () => {
    expect(s().standards).toBe(DEFAULT_STANDARDS);
  });

  it("setStandards re-designs: a plywood rate changes the cost", () => {
    const before = s().result.design!.materialCostUsd;
    expect(s().setStandards({ rates: { costUsdPerM3: { plywood: 2200 } } })).toBeNull();
    expect(s().standards.rates.costUsdPerM3).toEqual({ plywood: 2200, lumber: 650 });
    expect(s().result.design!.materialCostUsd).toBeGreaterThan(before);
  });

  it("setStandards re-designs: a threshold changes the panel", () => {
    expect(s().result.design!.construction.panelMm).toBe(12);
    s().setStandards({ construction: { panelLightMaxKg: 50 } });
    expect(s().result.design!.construction.panelMm).toBe(15);
  });

  it("rejects an invalid patch and changes nothing", () => {
    const before = s().standards;
    const result = s().result;
    expect(s().setStandards({ rates: { densityKgM3: { plywood: -1 } } })).toMatch(/rates\.densityKgM3\.plywood/);
    expect(s().standards).toBe(before);
    expect(s().result).toBe(result);
  });

  it("a changed default gap is applied to the current rules and used by Reset rules", () => {
    s().setSettings({ wallClearanceMm: 80 });
    s().setStandards({ defaults: { partGapMm: 30 } });
    expect(s().settings.partGapMm).toBe(30);
    expect(s().settings.wallClearanceMm).toBe(80); // its default didn't change
    s().resetRules();
    expect(s().settings).toMatchObject({ partGapMm: 30, wallClearanceMm: 50 });
  });

  it("resetStandards goes back to the defaults", () => {
    s().setStandards({ rates: { costUsdPerM3: { plywood: 2200 } }, defaults: { maxLayers: 1 } });
    s().resetStandards();
    expect(sameStandards(s().standards, DEFAULT_STANDARDS)).toBe(true);
    expect(s().settings.maxLayers).toBe(2);
    expect(s().result.design!.materialCostUsd).toBe(initial.result.design!.materialCostUsd);
  });

  it("keeps the standards when the part changes", () => {
    s().setStandards({ rates: { costUsdPerM3: { lumber: 1300 } } });
    s().setPartDetails({ name: "ignored for catalog parts" });
    s().setSettings({ quantity: 8 });
    expect(s().standards.rates.costUsdPerM3.lumber).toBe(1300);
  });
});
