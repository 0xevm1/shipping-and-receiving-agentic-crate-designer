import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import type { PartProfile } from "@/domain/profile";
import { catalogPart, type LoadedPart } from "@/lib/part";
import { emitDesignEdit, onDesignEdit, type DesignEdit } from "./designEvents";
import { useDesigner } from "./store";
import { useView } from "./viewStore";

/**
 * The design store tells the view store what a design action did (`designEvents.ts`) and the view
 * reacts: a stale hover or pin goes, the camera re-frames, the change note is written, the
 * time-to-design clock restarts or stops. These tests pin that coupling from both ends.
 */

const designInitial = useDesigner.getState();
const viewInitial = useView.getState();
const d = () => useDesigner.getState();
const v = () => useView.getState();

/** An unknown part as `loadPartFiles` builds it: stand-in mass, no material. */
const unknownPart: LoadedPart = {
  id: "widget",
  name: "Widget",
  mass_kg: 10,
  dimensions_mm: [1, 1, 1],
  suggested_quantities: [1, 4, 8],
  modelUrl: "blob:widget",
  modelUnits: "m",
  upAxis: "z",
  unitsGuessed: true,
  mmPerUnit: 1000,
  rawSize: [0.001, 0.001, 0.001],
  massAssumed: true,
};

/** A flat profile, except the -X face is set back 30 mm above half height (shaped blocking). */
const profile = (): PartProfile => {
  const face = (cols: number, rows: number, depth: (r: number) => number = () => 0) => ({
    cols,
    rows,
    depth: Array.from({ length: cols * rows }, (_, i) => depth(Math.floor(i / cols))),
  });
  return {
    version: 1,
    sizeMm: [300, 200, 100],
    cellMm: 5,
    faces: {
      "-x": face(40, 20, (r) => (r >= 10 ? 30 : 0)),
      "+x": face(40, 20),
      "-y": face(60, 20),
      "+y": face(60, 20),
      "-z": face(60, 40),
      "+z": face(60, 40),
    },
  };
};

beforeEach(() => {
  useDesigner.setState(designInitial, true);
  useView.setState(viewInitial, true);
});

afterEach(() => vi.useRealTimers());

/** Counts the view store's notifications while `run` does its work. */
function viewNotifications(run: () => void): number {
  const seen = vi.fn();
  const off = useView.subscribe(seen);
  run();
  off();
  return seen.mock.calls.length;
}

describe("opening a part or a saved design", () => {
  it("clears a pin, a hover and the change note, and re-frames once", () => {
    d().setSettings({ quantity: 4 });
    v().setPin("some-line");
    v().setHover({ key: "some-line", source: "list" });
    expect(v().lastChange).not.toBeNull();
    const nonce = v().fit.nonce;

    d().setPart(catalogPart(getPart("PART-002")));
    expect(v()).toMatchObject({ pin: null, hover: null, lastChange: null });
    expect(v().fit).toEqual({ nonce: nonce + 1, instant: false });
  });

  it("does the same for loadDesign and restoreDesign, in one view update each", () => {
    const part = catalogPart(getPart("PART-002"));
    for (const open of [
      () => d().loadDesign(part, { ...DEFAULT_SETTINGS, quantity: 6 }, null),
      () => d().restoreDesign(part, { ...DEFAULT_SETTINGS, quantity: 8 }, null, 0, "cost"),
    ]) {
      v().setPin("x");
      v().setHover({ key: "x", source: "3d" });
      const nonce = v().fit.nonce;
      expect(viewNotifications(open)).toBe(1);
      expect(v()).toMatchObject({ pin: null, hover: null });
      expect(v().fit.nonce).toBe(nonce + 1);
    }
  });

  it("keeps the tab: it is not part of the design", () => {
    v().setTab("rules");
    d().setPart(catalogPart(getPart("PART-002")));
    d().restoreDesign(catalogPart(getPart("PART-001")), DEFAULT_SETTINGS, null, 0, "volume");
    expect(v().tab).toBe("rules");
  });

  it("starts the time-to-design clock for a new part or design, and leaves a reopened crate without one", () => {
    v().startDesignClock(1000);
    v().markExported(2000);
    d().setPart(catalogPart(getPart("PART-002")));
    expect(v().designedInMs).toBeNull();
    expect(v().designStartedAt).toBeGreaterThan(1000);

    v().markExported(Date.now() + 5000);
    expect(v().designedInMs).not.toBeNull();
    d().loadDesign(catalogPart(getPart("PART-001")), DEFAULT_SETTINGS, null);
    expect(v().designedInMs).toBeNull();
    expect(v().designStartedAt).not.toBeNull();

    d().restoreDesign(catalogPart(getPart("PART-001")), DEFAULT_SETTINGS, null, 0, "volume");
    expect(v().designStartedAt).toBeNull();
    expect(v().designedInMs).toBeNull();
  });
});

describe("editing an input", () => {
  beforeEach(() => d().setPart({ ...unknownPart }));

  it("records a mass edit's diff and source, and re-frames because the part changed", () => {
    const nonce = v().fit.nonce;
    d().setPartDetails({ mass_kg: 14.71 });
    const c = v().lastChange!;
    expect(c.source).toBe("mass");
    expect(c.changes.map((x) => x.field)).toEqual(["gross", "payload"]);
    const gross = c.changes[0];
    expect([Math.round(gross.from as number), Math.round(gross.to as number)]).toEqual([16, 20]);
    expect(v().fit.nonce).toBe(nonce + 1);
  });

  it("records a change of the file's units or up axis (source frame), and re-frames", () => {
    d().setPart({ ...unknownPart, rawSize: [0.3, 0.2, 0.1], dimensions_mm: [300, 200, 100] });
    const nonce = v().fit.nonce;
    expect(d().setPartFrame({ up: "y" })).toBeNull();
    expect(v().lastChange?.source).toBe("frame");
    expect(v().fit.nonce).toBe(nonce + 1);
    // Choosing what is already in use is no edit.
    const before = v().lastChange;
    d().setPartFrame({ up: "y" });
    expect(v().lastChange).toBe(before);
  });

  it("records rules and layout edits, but not units or tab changes", () => {
    d().setSettings({ quantity: 4 });
    expect(v().lastChange?.source).toBe("rules");
    expect(v().lastChange?.changes.map((x) => x.field)).toContain("grid");
    const before = v().lastChange;
    v().setUnits("metric", null);
    v().setTab("checks");
    v().setView({ dims: false });
    expect(v().lastChange).toBe(before);
    d().setLayoutKey(d().result.layouts[d().result.layouts.length - 1].key);
    expect(v().lastChange?.source).toBe("layout");
  });

  it("records a reset of the rules as a rules edit and a ranking change as a layout edit", () => {
    d().resetRules();
    expect(v().lastChange?.source).toBe("rules");
    d().setRanking("cost");
    expect(v().lastChange?.source).toBe("layout");
  });

  it("a shop standards change clears the note: the person's edit wasn't the cause", () => {
    d().setSettings({ quantity: 4 });
    expect(v().lastChange).not.toBeNull();
    expect(d().setStandards({ labour: { rateUsdPerHour: 70 } })).toBeNull();
    expect(v().lastChange).toBeNull();
  });

  it("each edit's note numbers on from the last, and leaves nothing to compare when the design becomes a problem", () => {
    d().setSettings({ quantity: 4 });
    const id = v().lastChange!.id;
    d().setSettings({ quantity: 8 });
    expect(v().lastChange!.id).toBe(id + 1);
    d().setPart({ ...unknownPart, dimensions_mm: [30_000, 1, 1] });
    d().setPartDetails({ mass_kg: 5 });
    expect(v().lastChange).toBeNull();
  });

  it("re-frames only when the crate size (layout) changed, not for an edit that leaves it alone", () => {
    const nonce = v().fit.nonce;
    d().setStandards({ labour: { rateUsdPerHour: 70 } });
    expect(v().fit.nonce).toBe(nonce);
    d().setSettings({ quantity: 8 });
    expect(v().fit.nonce).toBe(nonce + 1);
  });

  it("clears the hover, drops a pin whose line is gone and keeps a pin whose line is still there", () => {
    const kept = d().result.design!.bom[0].key;
    v().setPin(kept);
    v().setHover({ key: kept, source: "list" });
    d().setStandards({ labour: { rateUsdPerHour: 70 } });
    expect(v().pin).toBe(kept);
    expect(v().hover).toBeNull();

    v().setPin("no-such-line");
    d().setSettings({ partGapMm: 30 });
    expect(v().pin).toBeNull();
  });

  it("drops the pin when the design becomes a problem and there is no cut list at all", () => {
    v().setPin(d().result.design!.bom[0].key);
    d().setSettings({ quantity: 4 });
    d().setPart({ ...unknownPart, dimensions_mm: [30_000, 1, 1] });
    expect(d().result.design).toBeNull();
    v().setPin("anything");
    d().setSettings({ quantity: 2 });
    expect(v().pin).toBeNull();
  });

  it("makes the stale clock go: an edit clears 'Designed in', and the next export records the edited design", () => {
    const t0 = v().designStartedAt!; // the part just loaded started it
    v().markExported(t0 + 72_000);
    expect(v().designedInMs).toBe(72_000);
    d().setSettings({ quantity: 2 });
    expect(v().designedInMs).toBeNull();
    v().markExported(t0 + 99_000);
    expect(v().designedInMs).toBe(99_000);
  });

  it("reaches the view in one update, after the design store already holds the new design", () => {
    const before = d().result;
    const seen: Array<{ result: unknown; lastChange: unknown }> = [];
    const off = useView.subscribe((s) => seen.push({ result: d().result, lastChange: s.lastChange }));
    d().setSettings({ quantity: 4 });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].result).not.toBe(before);
    expect(seen[0].result).toBe(d().result);
    expect(seen[0].lastChange).toBe(v().lastChange);
  });

  it("makes the design store notify once per edit: no second plan behind the view's reaction", () => {
    const seen = vi.fn();
    const off = useDesigner.subscribe(seen);
    d().setSettings({ quantity: 4 });
    d().setLayoutKey(d().result.layouts[d().result.layouts.length - 1].key);
    d().setRanking("density");
    off();
    expect(seen).toHaveBeenCalledTimes(3);
  });
});

describe("the change note's lifetime", () => {
  it("goes after five seconds, and an older edit's timer never takes a newer note", () => {
    vi.useFakeTimers();
    d().setSettings({ quantity: 4 });
    vi.advanceTimersByTime(3000);
    d().setSettings({ quantity: 8 });
    const second = v().lastChange;
    vi.advanceTimersByTime(4999);
    expect(v().lastChange).toBe(second);
    vi.advanceTimersByTime(1);
    expect(v().lastChange).toBeNull();
  });
});

describe("refining the result with the camera and the layout pick kept", () => {
  beforeEach(() => d().setPart({ ...unknownPart }));

  it("a name or material edit writes a note for that source, and moves nothing else", () => {
    const keys = d().result.layouts.map((l) => l.key);
    d().setLayoutKey(keys[keys.length - 1]);
    const kept = d().result.design!.bom[0].key;
    v().setPin(kept);
    v().setHover({ key: kept, source: "3d" });
    v().markExported(v().designStartedAt! + 1000);
    const nonce = v().fit.nonce;

    d().setPartDetails({ material: "4140 steel" });
    expect(v().lastChange).toMatchObject({ source: "material", changes: [] });
    const id = v().lastChange!.id;
    d().setPartDetails({ name: "Cover" });
    expect(v().lastChange).toMatchObject({ source: "name", changes: [], id: id + 1 });

    expect(v().fit.nonce).toBe(nonce);
    expect(v()).toMatchObject({ pin: kept, designedInMs: 1000 });
    expect(v().hover?.key).toBe(kept);
    expect(d().layoutKey).toBe(keys[keys.length - 1]);
  });

  it("a measured profile drops a pin or hover on a line the shaped design no longer has, and keeps one it still has", () => {
    const kept = d().result.design!.bom[0].key;
    v().setPin(kept);
    v().setHover({ key: kept, source: "list" });
    d().setSettings({ quantity: 4 });
    const note = v().lastChange;
    const nonce = v().fit.nonce;
    v().setPin(kept);
    v().setHover({ key: kept, source: "list" });
    d().setPartProfile("blob:widget", profile());
    expect(v().pin).toBe(kept);
    expect(v().hover?.key).toBe(kept);

    v().setPin("no-such-line");
    v().setHover({ key: "no-such-line", source: "list" });
    useDesigner.setState({ part: { ...d().part, profile: undefined } });
    d().setPartProfile("blob:widget", profile());
    expect(v().pin).toBeNull();
    expect(v().hover).toBeNull();
    // Neither the camera nor the note is touched by a profile arriving.
    expect(v().fit.nonce).toBe(nonce);
    expect(v().lastChange).toBe(note);
  });
});

describe("showing another crate type", () => {
  beforeEach(() => d().setSettings({ quantity: 200 }));

  it("clears the pin and the hover and re-frames once, without touching the change note", () => {
    expect(d().plan.crates).toHaveLength(2);
    const note = v().lastChange;
    expect(note).not.toBeNull();
    const nonce = v().fit.nonce;
    v().setPin(d().result.design!.bom[0].key);
    v().setHover({ key: "x", source: "3d" });

    expect(viewNotifications(() => d().setCrateIndex(1))).toBe(1);
    expect(d().crateIndex).toBe(1);
    expect(v()).toMatchObject({ pin: null, hover: null });
    expect(v().fit.nonce).toBe(nonce + 1);
    expect(v().lastChange).toBe(note);
  });
});

describe("nothing fires when the design did not change", () => {
  beforeEach(() => d().setSettings({ quantity: 200 }));

  it("ignored actions leave the view alone", () => {
    const events: DesignEdit[] = [];
    const off = onDesignEdit((e) => events.push(e));
    v().setPin("some-line");
    const view = v();
    const design = d();

    const notified = viewNotifications(() => {
      d().setCrateIndex(0); // already shown
      d().setCrateIndex(9); // out of range
      d().setCrateIndex(-1);
      d().setRanking("volume"); // already ranked so
      expect(d().setPartDetails({ name: "Renamed" })).not.toBeNull(); // a catalog part is read-only
      d().setPartProfile("blob:other", profile()); // not the model on screen
      d().setPartProfile(d().part.modelUrl, null); // failed analysis
      d().setMeasured([1, 2, 3]);
      d().addCatalogParts([]);
      d().loadSavedStandards(); // nothing saved: the defaults it already has
    });
    off();

    expect(events).toEqual([]);
    expect(notified).toBe(0);
    expect(v()).toBe(view);
    expect(d().plan).toBe(design.plan);
    expect(d().result).toBe(design.result);
  });

  it("invalid input does not reach the view", () => {
    d().setPart({ ...unknownPart });
    v().setPin("some-line");
    const view = v();
    expect(d().setPartDetails({ name: " " })).not.toBeNull();
    expect(d().setStandards({ labour: { rateUsdPerHour: -5 } })).not.toBeNull();
    expect(v()).toBe(view);
  });

  it("view-only changes do not touch the design", () => {
    const design = d();
    v().setTab("cut");
    v().setMode("exploded");
    v().setView({ blocking: false });
    v().setPin("x");
    v().setHover({ key: "x", source: "list" });
    v().togglePanels();
    v().setUnits("metric", null);
    expect(d()).toBe(design);
  });
});

describe("the event channel", () => {
  it("tells every listener, synchronously, until it is removed", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onDesignEdit(a);
    const offB = onDesignEdit(b);
    emitDesignEdit({ type: "crate-switched" });
    expect(a).toHaveBeenCalledWith({ type: "crate-switched" });
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    emitDesignEdit({ type: "crate-switched" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });
});
