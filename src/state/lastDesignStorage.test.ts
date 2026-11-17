import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDesignFile } from "@/lib/currentDesign";
import { shareHash } from "@/domain/shareLink";
import {
  createDebouncedSaver,
  LAST_DESIGN_SAVE_DELAY_MS,
  LAST_DESIGN_STORAGE_KEY,
  lastDesignToJson,
  loadLastDesign,
  parseLastDesign,
  saveLastDesign,
  startupSource,
  type LastDesign,
} from "./lastDesignStorage";
import { lastDesignOf } from "./lastDesignLoader";
import { useDesigner } from "./store";

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

const throwing = {
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

const sample = (): LastDesign => ({
  design: currentDesignFile(useDesigner.getState(), "2026-11-16T12:00:00.000Z")!,
  tab: "rules",
  ranking: "cost",
});

describe("last-opened crate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("round-trips the design file, tab and ranking under a versioned key", () => {
    const store = memoryStorage();
    expect(LAST_DESIGN_STORAGE_KEY).toBe("crate-designer.last-design.v1");
    const d = sample();
    expect(saveLastDesign(d, store)).toBe(true);
    const json = JSON.parse(store.data.get(LAST_DESIGN_STORAGE_KEY)!);
    expect(json).toMatchObject({ kind: "crate-designer.last-design", version: 1, tab: "rules", ranking: "cost" });
    expect(json.design.kind).toBe("crate-design");
    expect(loadLastDesign(store)).toEqual(d);
  });

  it("builds the entry from the store state, or null when there is no crate", () => {
    const s = useDesigner.getState();
    const d = lastDesignOf(s)!;
    expect(d.tab).toBe(s.tab);
    expect(d.ranking).toBe(s.ranking);
    expect(d.design.part).toMatchObject({ source: "catalog", id: "PART-001" });
    expect(d.design.settings).toEqual(s.settings);
    expect(lastDesignOf({ ...s, result: { ...s.result, design: null } })).toBeNull();
  });

  it("gives null when nothing is saved or storage is unavailable", () => {
    expect(loadLastDesign(memoryStorage())).toBeNull();
    expect(loadLastDesign(null)).toBeNull();
    expect(loadLastDesign(throwing)).toBeNull();
  });

  it("ignores bad or old data with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = JSON.parse(lastDesignToJson(sample()));
    const bad = [
      "{not json",
      "[]",
      JSON.stringify({ ...good, kind: "something-else" }),
      JSON.stringify({ ...good, version: 2 }),
      JSON.stringify({ ...good, tab: "nope" }),
      JSON.stringify({ ...good, ranking: "fastest" }),
      JSON.stringify({ ...good, design: { ...good.design, settings: { ...good.design.settings, quantity: -3 } } }),
      JSON.stringify({ ...good, design: { ...good.design, schemaVersion: 99 } }),
      JSON.stringify({ ...good, design: undefined }),
    ];
    for (const text of bad) {
      expect(parseLastDesign(text).ok).toBe(false);
      const store = memoryStorage();
      store.setItem(LAST_DESIGN_STORAGE_KEY, text);
      expect(loadLastDesign(store)).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(bad.length);
  });

  it("a refused save (quota, blocked) is not an error", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(saveLastDesign(sample(), throwing)).toBe(false);
    expect(saveLastDesign(sample(), null)).toBe(false);
  });

  it("precedence: a share link, else the last-opened crate, else the default part", () => {
    const d = sample();
    const link = shareHash(d.design);
    expect(startupSource(link, d)).toBe("share");
    expect(startupSource(link, null)).toBe("share");
    // Even a damaged link wins: it says why it wasn't opened, over the default crate.
    expect(startupSource("#design=garbage", d)).toBe("share");
    expect(startupSource("", d)).toBe("last");
    expect(startupSource("#other", d)).toBe("last");
    expect(startupSource("", null)).toBe("default");
  });
});

describe("debounced save", () => {
  afterEach(() => vi.useRealTimers());

  it("writes once after the edits stop, with the latest value", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const saver = createDebouncedSaver<number>(save);
    saver.schedule(1);
    vi.advanceTimersByTime(LAST_DESIGN_SAVE_DELAY_MS - 1);
    saver.schedule(2);
    vi.advanceTimersByTime(LAST_DESIGN_SAVE_DELAY_MS - 1);
    saver.schedule(3);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LAST_DESIGN_SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
  });

  it("flush writes a pending value now (page hide); cancel drops it", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const saver = createDebouncedSaver<string>(save, 100);
    saver.flush();
    expect(save).not.toHaveBeenCalled();
    saver.schedule("a");
    saver.flush();
    expect(save).toHaveBeenCalledWith("a");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    saver.schedule("b");
    saver.cancel();
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
