import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPart } from "@/domain/catalog";
import type { PartProfile } from "@/domain/profile";
import type { QuantitySweep } from "@/domain/sweep";
import { runSweep, type SweepRequest, type SweepResponse } from "@/engine/sweep";
import { catalogPart, type LoadedPart } from "@/lib/part";
import { startSweeps, useSweep } from "./bestQuantity";
import { engine, type EngineClient } from "./engineClient";
import { useDesigner } from "./store";
import { useView } from "./viewStore";

/**
 * Loading a new part opens it at the quantity sweep's recommendation (spec §7.16), once, unless
 * the person edits first; designs that are opened (saved, imported, shared, restored) keep their
 * own settings. The sweeps wait in a queue here, so each test decides when a result arrives.
 */

// Each test runs real sweeps (a few hundred designs each): about a second alone, several under a
// full parallel run, so the default 5 s is too tight.
vi.setConfig({ testTimeout: 20_000 });

const queue: { req: SweepRequest; apply: (out: SweepResponse) => void }[] = [];
const fakeEngine: EngineClient = {
  designSync: engine.designSync,
  design: engine.design,
  sweep: (req, apply) => void queue.push({ req, apply }),
  inWorker: false,
};

/** Runs the oldest waiting sweep for real and hands its result back, changed by `tweak` if given. */
function answer(tweak: (sweep: QuantitySweep) => QuantitySweep = (x) => x): QuantitySweep {
  const job = queue.shift();
  if (!job) throw new Error("no sweep is waiting");
  const out = runSweep(job.req);
  const sweep = tweak(out.sweep);
  job.apply({ ...out, sweep });
  return sweep;
}

/** The same sweep recommending its shortlist's `i`-th entry instead (a valid quantity and layout). */
const recommendEntry =
  (i: number) =>
  (sweep: QuantitySweep): QuantitySweep => {
    const p = sweep.shortlist[i];
    return { ...sweep, recommendation: { ...sweep.recommendation!, quantity: p.quantity, crate: p.crate! } };
  };

/** An unknown part as `loadPartFiles` builds it. */
const widget: LoadedPart = {
  id: "widget",
  name: "Widget",
  mass_kg: 10,
  dimensions_mm: [300, 200, 100],
  suggested_quantities: [1, 4, 8],
  modelUrl: "blob:widget",
  modelUnits: "m",
  upAxis: "z",
  unitsGuessed: true,
  mmPerUnit: 1000,
  rawSize: [0.3, 0.2, 0.1],
  massAssumed: true,
};

/** A flat profile for the widget: what the outline analysis hands `setPartProfile`. */
const profile = (): PartProfile => {
  const face = (cols: number, rows: number) => ({ cols, rows, depth: Array.from({ length: cols * rows }, () => 0) });
  return {
    version: 1,
    sizeMm: [300, 200, 100],
    cellMm: 5,
    faces: { "-x": face(40, 20), "+x": face(40, 20), "-y": face(60, 20), "+y": face(60, 20), "-z": face(60, 40), "+z": face(60, 40) },
  };
};

const initial = useDesigner.getState();
const initialView = useView.getState();
const s = () => useDesigner.getState();
/** The change note is view state (`viewStore.ts`), told of each edit by the design store. */
const lastChange = () => useView.getState().lastChange;
const shaft = () => catalogPart(getPart("PART-002"));
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  useDesigner.setState(initial, true);
  useView.setState(initialView, true);
  useSweep.setState({ inputs: null, done: null });
  queue.length = 0;
  stop = startSweeps(fakeEngine);
  vi.runOnlyPendingTimers();
  queue.length = 0; // the default part's sweep: not under test
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

/** Loads `part` as a picked GLB or catalog part does, and lets its sweep start. */
function loadPart(part: LoadedPart) {
  s().setPart(part);
  vi.advanceTimersByTime(0);
}

describe("a newly loaded part opens at the recommendation", () => {
  it("sets the recommended quantity and layout once its sweep arrives, with a change note", () => {
    loadPart(shaft());
    expect(s().settings.quantity).toBe(shaft().suggested_quantities[0]);
    expect(s().autoRecommend).toEqual({ modelUrl: shaft().modelUrl, applied: false });

    const rec = answer().recommendation!;
    expect(rec.quantity).not.toBe(shaft().suggested_quantities[0]);
    expect(s().settings.quantity).toBe(rec.quantity);
    expect(s().layoutKey).toBe(rec.crate.layoutKey);
    expect(s().result.design!.layout.key).toBe(rec.crate.layoutKey);
    expect(s().plan.crates).toHaveLength(1);
    expect(lastChange()).toMatchObject({ source: "recommended", note: `Set to the recommended ${rec.quantity} per crate` });
    // Applied; one more is due when the outline is measured.
    expect(s().autoRecommend).toEqual({ modelUrl: shaft().modelUrl, applied: true });
  });

  it("is swept at once, not after the rules' debounce", () => {
    s().setPart(shaft());
    expect(queue).toHaveLength(0);
    vi.advanceTimersByTime(0);
    expect(queue).toHaveLength(1);
  });

  it("applies once more for the measured outline, then settles", () => {
    loadPart(widget);
    const first = answer().recommendation!;
    expect(s().settings.quantity).toBe(first.quantity);

    s().setPartProfile("blob:widget", profile());
    vi.advanceTimersByTime(0);
    // The measured outline moves the recommendation (here: to the shortlist's second entry).
    const measured = answer(recommendEntry(1)).recommendation!;
    expect(measured.quantity).not.toBe(first.quantity);
    expect(s().settings.quantity).toBe(measured.quantity);
    expect(s().layoutKey).toBe(measured.crate.layoutKey);
    expect(lastChange()?.note).toBe(`Set to the recommended ${measured.quantity} per crate`);
    expect(s().autoRecommend).toBeNull();

    // Settled: a later result changes nothing.
    const settings = s().settings;
    s().applyRecommendation(s().part, recommendEntry(2)(runSweep(sweepRequest()).sweep));
    expect(s().settings).toBe(settings);
  });

  it("settles without a change when the measured outline keeps the recommendation", () => {
    loadPart(widget);
    answer();
    const change = lastChange();
    s().setPartProfile("blob:widget", profile());
    vi.advanceTimersByTime(0);
    answer();
    expect(s().autoRecommend).toBeNull();
    expect(lastChange()).toBe(change);
  });

  it("settles when the outline analysis fails (no second result is coming)", () => {
    loadPart(widget);
    answer();
    s().setPartProfile("blob:widget", null);
    expect(s().autoRecommend).toBeNull();
  });

  it("ignores another result for the unmeasured part once applied", () => {
    loadPart(widget);
    const first = answer().recommendation!;
    s().applyRecommendation(s().part, recommendEntry(1)(runSweep(sweepRequest()).sweep));
    expect(s().settings.quantity).toBe(first.quantity);
    expect(s().autoRecommend?.applied).toBe(true);
  });

  it("applies only the result for the part on screen", () => {
    loadPart(shaft());
    loadPart(widget);
    // The shaft's result arrives after the widget was loaded: not applied.
    answer();
    expect(s().settings.quantity).toBe(widget.suggested_quantities[0]);
    expect(s().autoRecommend?.applied).toBe(false);
    const rec = answer().recommendation!;
    expect(s().settings.quantity).toBe(rec.quantity);
  });
});

describe("the file's units or up axis, set on a part still at its recommendation (#105)", () => {
  it("waits for the recommendation for the part's new size", () => {
    loadPart(widget);
    answer();
    expect(s().autoRecommend?.applied).toBe(true);
    expect(s().setPartFrame({ units: "mm" })).toBeNull();
    // A quantity swept for a misread size means nothing: the next result is applied again.
    expect(s().autoRecommend).toEqual({ modelUrl: widget.modelUrl, applied: false });
    vi.advanceTimersByTime(0);
    const rec = answer().recommendation!;
    expect(s().part.dimensions_mm).toEqual([0.3, 0.2, 0.1]);
    expect(s().settings.quantity).toBe(rec.quantity);
  });

  it("even once the first recommendation has settled", () => {
    loadPart(widget);
    answer();
    s().setPartProfile("blob:widget", profile());
    vi.advanceTimersByTime(0);
    answer();
    expect(s().autoRecommend).toBeNull();
    s().setPartFrame({ units: "in" });
    expect(s().autoRecommend).toEqual({ modelUrl: widget.modelUrl, applied: false });
    vi.advanceTimersByTime(0);
    const rec = answer().recommendation!;
    expect(s().settings.quantity).toBe(rec.quantity);
  });

  it("not once the person has set the rules", () => {
    loadPart(widget);
    answer();
    s().setSettings({ quantity: 3 });
    s().setPartFrame({ up: "y" });
    expect(s().autoRecommend).toBeNull();
    vi.runOnlyPendingTimers();
    while (queue.length) answer();
    expect(s().settings.quantity).toBe(3);
  });
});

describe("an edit before the result is kept", () => {
  it.each([
    ["the quantity", () => s().setSettings({ quantity: 7 })],
    ["a rule", () => s().setSettings({ partGapMm: 40 })],
    ["the layout", () => s().setLayoutKey(s().result.layouts.at(-1)!.key)],
    ["the ranking", () => s().setRanking("cost")],
    ["the part's mass", () => void s().setPartDetails({ mass_kg: 12 })],
    ["the shop standards", () => void s().setStandards({ defaults: { partGapMm: 30 } })],
  ])("%s", (_, edit) => {
    loadPart(widget);
    edit();
    const { settings, layoutKey } = s();
    expect(s().autoRecommend).toBeNull();
    vi.runOnlyPendingTimers();
    while (queue.length) answer();
    expect(s().settings).toEqual(settings);
    expect(s().layoutKey).toBe(layoutKey);
    expect(lastChange()?.source).not.toBe("recommended");
  });

  it("including one after the first result: the measured outline doesn't override it", () => {
    loadPart(widget);
    answer();
    s().setSettings({ quantity: 3 });
    s().setPartProfile("blob:widget", profile());
    vi.advanceTimersByTime(0);
    answer(recommendEntry(1));
    expect(s().settings.quantity).toBe(3);
  });
});

describe("an opened design keeps its own settings", () => {
  const ownSettings = () => ({ ...s().settings, quantity: 3 });

  it("a saved, imported or shared design (`loadDesign`)", () => {
    s().loadDesign(shaft(), ownSettings(), null);
    vi.advanceTimersByTime(0);
    expect(s().autoRecommend).toBeNull();
    answer();
    expect(s().settings.quantity).toBe(3);
    expect(lastChange()).toBeNull();
  });

  it("the last design, restored at startup (`restoreDesign`)", () => {
    s().restoreDesign(shaft(), ownSettings(), null, 0, "volume");
    vi.advanceTimersByTime(0);
    answer();
    expect(s().settings.quantity).toBe(3);
  });

  it("a design opened while a new part waits for its result", () => {
    loadPart(widget);
    s().loadDesign(shaft(), ownSettings(), null);
    vi.advanceTimersByTime(0);
    while (queue.length) answer();
    expect(s().settings.quantity).toBe(3);
  });
});

describe("a newly loaded part opens at the cheapest of its suggested quantities (#133)", () => {
  it.each([
    ["PART-001", 8],
    ["PART-002", 4],
    ["PART-003", 8],
  ])("%s opens at %i per crate, not at the cheapest of all 200", (id, quantity) => {
    const part = catalogPart(getPart(id));
    loadPart(part);
    const request = queue[0].req;
    expect(request.candidates).toEqual([...part.suggested_quantities].sort((a, b) => a - b));
    const sweep = answer();
    expect(part.suggested_quantities).toContain(sweep.recommendation!.quantity);
    expect(s().settings.quantity).toBe(quantity);
    expect(lastChange()?.note).toBe(`Set to the recommended ${quantity} per crate`);
  });

  it("a loaded GLB with no catalog entry opens at the cheapest of 1, 4 and 8", () => {
    loadPart(widget);
    expect(queue[0].req.candidates).toEqual([1, 4, 8]);
    const sweep = answer();
    expect([1, 4, 8]).toContain(s().settings.quantity);
    expect(s().settings.quantity).toBe(sweep.recommendation!.quantity);
    expect(sweep.shortlist.every((p) => [1, 4, 8].includes(p.quantity))).toBe(true);
  });

  it("a part suggested in 2 and 6 opens at one of them", () => {
    loadPart({ ...widget, id: "pair", modelUrl: "blob:pair", suggested_quantities: [2, 6] });
    expect(queue[0].req.candidates).toEqual([2, 6]);
    answer();
    expect([2, 6]).toContain(s().settings.quantity);
  });

  it("applies nothing when no suggested quantity passes: the part stays at its first suggested quantity", () => {
    // 4 or 8 of these are over the per-crate gross limit before the crate is built.
    loadPart({ ...widget, id: "heavy", modelUrl: "blob:heavy", mass_kg: 400, suggested_quantities: [4, 8] });
    expect(s().settings.quantity).toBe(4);
    const sweep = answer();
    expect(sweep.recommendation).toBeNull();
    expect(s().settings.quantity).toBe(4);
    expect(s().autoRecommend).toBeNull();
    expect(lastChange()?.source).not.toBe("recommended");
  });
});

/** A sweep request for the part and rules on screen. */
function sweepRequest(): SweepRequest {
  const { restingFaces, maxLayers, partGapMm, wallClearanceMm, panelThickness } = s().settings;
  return { part: s().part, rules: { restingFaces, maxLayers, partGapMm, wallClearanceMm, panelThickness }, standards: s().standards };
}
