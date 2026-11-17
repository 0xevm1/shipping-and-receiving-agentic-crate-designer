import { ANY_FACES } from "@/domain/orientations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPart } from "@/domain/catalog";
import { inputHash } from "@/engine/engine";
import { catalogPart } from "@/lib/part";
import type { FakeEngineWorker } from "./fakeEngineWorker";

/** The store with its engine in a (stand-in) Web Worker: designs land when the worker answers. */
const fake = vi.hoisted(() => ({ worker: null as FakeEngineWorker | null }));
vi.mock("./engineClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("./engineClient")>();
  const { FakeEngineWorker } = await import("./fakeEngineWorker");
  fake.worker = new FakeEngineWorker();
  return { ...real, engine: real.createEngineClient(() => fake.worker) };
});

const { useDesigner, whenDesigned } = await import("./store");
const { useView } = await import("./viewStore");
const initial = useDesigner.getState();
const initialView = useView.getState();
const s = () => useDesigner.getState();
const flush = () => fake.worker!.flush();

describe("store with the engine in a worker", () => {
  beforeEach(() => {
    flush();
    useDesigner.setState(initial, true);
    useView.setState(initialView, true);
  });

  it("opens with a design made in this thread, stamped", () => {
    expect(initial.plan.totals.parts).toBe(initial.settings.quantity);
    expect(initial.designedFrom.settings).toBe(initial.settings);
    expect(initial.designedFrom.inputHash).toBe(inputHash(initial.designedFrom));
  });

  it("shows an edit at once and its design when the engine answers", () => {
    s().setSettings({ quantity: 5 });
    expect(s().settings.quantity).toBe(5);
    expect(s().plan).toBe(initial.plan);
    expect(s().designedFrom.settings.quantity).toBe(initial.settings.quantity);
    flush();
    expect(s().plan.totals.parts).toBe(5);
    expect(s().designedFrom.settings.quantity).toBe(5);
    expect(s().designedFrom.inputHash).toBe(inputHash(s().designedFrom));
    expect(useView.getState().lastChange?.source).toBe("rules");
  });

  it("keeps up with quick edits: each builds on the last, and the newest design wins", () => {
    for (let i = 0; i < 6; i++) s().setSettings({ partGapMm: s().settings.partGapMm + 5 });
    s().setSettings({ restingFaces: ANY_FACES });
    expect(s().settings).toMatchObject({ partGapMm: initial.settings.partGapMm + 30, restingFaces: ANY_FACES });
    flush();
    expect(s().designedFrom.settings).toEqual(s().settings);
    expect(s().result.design?.layout.slots).toHaveLength(initial.settings.quantity);
  });

  it("shows the crate type a design asks for once its plan has it", () => {
    const part = catalogPart(getPart("PART-002"));
    s().loadDesign(part, { ...initial.settings, quantity: 200 }, null, 1);
    expect(s().crateIndex).toBe(0);
    flush();
    expect(s().plan.split).toBe(true);
    expect(s().crateIndex).toBe(1);
    expect(s().result).toBe(s().plan.crates[1].result);
  });

  it("tells the view of an edit when its design lands, not before", () => {
    const fit = useView.getState().fit.nonce;
    s().setPart(catalogPart(getPart("PART-002")));
    expect(useView.getState().fit.nonce).toBe(fit);
    flush();
    expect(useView.getState().fit.nonce).toBe(fit + 1);
    expect(useView.getState().designStartedAt).not.toBeNull();
  });

  it("keeps the scene held until a reopened crate's design has landed (`whenDesigned`)", () => {
    useView.getState().setRestoring(true);
    s().restoreDesign(catalogPart(getPart("PART-003")), { ...initial.settings, quantity: 2 }, null, 0, "volume");
    whenDesigned(() => useView.getState().setRestoring(false));
    expect(useView.getState().restoring).toBe(true);
    flush();
    expect(useView.getState().restoring).toBe(false);
    expect(s().designedFrom.part.id).toBe("PART-003");
    // Nothing on its way: at once.
    let ran = false;
    whenDesigned(() => (ran = true));
    expect(ran).toBe(true);
  });
});
