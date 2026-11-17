import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentDesignFile } from "@/lib/currentDesign";
import { runSweep } from "@/engine/sweep";
import { useSweep } from "./bestQuantity";
import { beginLoad } from "./loadSequence";
import { createStartup, type StartupDeps } from "./startup";
import { useDesigner } from "./store";
import { useView } from "./viewStore";

const initial = useDesigner.getState();
const viewInitial = useView.getState();
const s = () => useDesigner.getState();

function savedCrate() {
  const design = currentDesignFile(s(), "2026-11-16T12:00:00.000Z")!;
  return { design, tab: "overview" as const, ranking: "cost" as const };
}

function deps(over: Partial<StartupDeps> = {}): StartupDeps {
  return {
    hash: () => "",
    savedDesign: () => null,
    restore: vi.fn(async () => true),
    openShare: vi.fn(async () => {}),
    ...over,
  };
}

describe("startup source", () => {
  beforeEach(() => {
    useDesigner.setState(initial, true);
    useView.setState(viewInitial, true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("runs once however many times it is called (StrictMode mounts twice)", async () => {
    const saved = savedCrate();
    const d = deps({ savedDesign: () => saved });
    const start = createStartup(d);
    const [a, b] = [start(), start()];
    expect(a).toBe(b);
    expect(await a).toBe("last");
    expect(d.restore).toHaveBeenCalledTimes(1);
    expect(d.openShare).not.toHaveBeenCalled();
  });

  it("a share link wins over the saved design, and a second call doesn't restore it over the link", async () => {
    const saved = savedCrate();
    let hash = "#design=abc";
    const d = deps({
      savedDesign: () => saved,
      hash: () => hash,
      // Opening the link removes the hash, as `openShareLink` does.
      openShare: vi.fn(async () => {
        hash = "";
      }),
    });
    const start = createStartup(d);
    expect(await start()).toBe("share");
    expect(await start()).toBe("share");
    expect(d.openShare).toHaveBeenCalledTimes(1);
    expect(d.restore).not.toHaveBeenCalled();
    expect(useView.getState().designStartedAt).not.toBeNull();
  });

  it("holds the scene back while restoring, then releases it", async () => {
    let finish!: (v: boolean) => void;
    const d = deps({ savedDesign: savedCrate, restore: () => new Promise<boolean>((r) => (finish = r)) });
    const done = createStartup(d)();
    expect(useView.getState().restoring).toBe(true);
    finish(true);
    await done;
    expect(useView.getState().restoring).toBe(false);
    expect(useView.getState().designStartedAt).toBeNull();
  });

  it("starts the clock when the last design could not reopen", async () => {
    await createStartup(deps({ savedDesign: savedCrate, restore: async () => false }))();
    expect(useView.getState().designStartedAt).not.toBeNull();
  });

  it("leaves the clock to a load that superseded the restore", async () => {
    const d = deps({
      savedDesign: savedCrate,
      restore: async () => {
        beginLoad();
        return false;
      },
    });
    await createStartup(d)();
    expect(useView.getState().designStartedAt).toBeNull();
  });

  it("the default part opens at its recommendation when there is nothing to restore", async () => {
    expect(await createStartup(deps())()).toBe("default");
    expect(s().autoRecommend).toEqual({ modelUrl: s().part.modelUrl, applied: false });
    // Its rules count as the recommendation's (a units or up-axis change re-recommends) until an edit.
    expect(s().onRecommendation).toBe(true);
    s().setSettings({ quantity: 3 });
    expect(s().onRecommendation).toBe(false);
  });

  it("the default part opens at its recommendation when the last design could not reopen", async () => {
    await createStartup(deps({ savedDesign: savedCrate, restore: async () => false }))();
    expect(s().autoRecommend).not.toBeNull();
  });

  it("a reopened crate or a share link keeps its own settings", async () => {
    await createStartup(deps({ savedDesign: savedCrate }))();
    expect(s().autoRecommend).toBeNull();
    useDesigner.setState(initial, true);
    await createStartup(deps({ hash: () => "#design=abc" }))();
    expect(s().autoRecommend).toBeNull();
  });

  it("applies a sweep result for the default part that arrived before startup decided", async () => {
    const part = s().part;
    const { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness } = s().settings;
    const inputs = { part, standards: s().standards, rules: { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness } };
    const { sweep } = runSweep({ ...inputs, standards: inputs.standards });
    useSweep.setState({ inputs, done: { inputs, sweep } });
    await createStartup(deps())();
    expect(s().settings.quantity).toBe(sweep.recommendation!.quantity);
    expect(s().layoutKey).toBe(sweep.recommendation!.crate.layoutKey);
    useSweep.setState({ inputs: null, done: null });
  });
});
