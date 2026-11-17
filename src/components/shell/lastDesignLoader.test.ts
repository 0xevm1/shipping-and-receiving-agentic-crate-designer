import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentDesignFile } from "@/lib/currentDesign";
import { saveLastGlb } from "@/state/glbCache";
import { useLibrary } from "@/state/libraryStore";
import { useDesigner } from "@/state/store";
import { restoreLastDesign } from "./lastDesignLoader";

const initial = useDesigner.getState();
const s = () => useDesigner.getState();

/** The default crate at quantity 8, two layers, on the Rules tab, ranked by cost. */
function savedCatalogCrate() {
  s().setSettings({ quantity: 8, maxLayers: 2 });
  const design = currentDesignFile(s(), "2026-11-16T12:00:00.000Z")!;
  useDesigner.setState(initial, true);
  return { design, tab: "rules" as const, ranking: "cost" as const };
}

describe("reopening the last crate (#71)", () => {
  beforeEach(() => useDesigner.setState(initial, true));
  afterEach(() => {
    vi.restoreAllMocks();
    useLibrary.getState().setPendingShare(null);
  });

  it("reopens a catalog crate with its rules, layout, tab and ranking, and leaves the clock stopped", async () => {
    const saved = savedCatalogCrate();
    s().startDesignClock(1000);
    expect(await restoreLastDesign(saved, new IDBFactory())).toBe(true);
    expect(s().settings).toMatchObject({ quantity: 8, maxLayers: 2 });
    expect(s().result.design?.layout.key).toBe(saved.design.layoutKey);
    expect(s().tab).toBe("rules");
    expect(s().ranking).toBe("cost");
    expect(s().loadMessage).toBe("");
    // Not newly loaded: no clock, so an export records no "Designed in" time.
    expect(s().designStartedAt).toBeNull();
    s().markExported(5000);
    expect(s().designedInMs).toBeNull();
    // A new part starts it again.
    s().setPart(s().part);
    expect(s().designStartedAt).not.toBeNull();
  });

  it("without the custom part's GLB, keeps the default part, names the file and waits for it", async () => {
    const saved = savedCatalogCrate();
    const custom = { ...saved, design: { ...saved.design, part: { ...saved.design.part, source: "custom" as const, model: "widget_v2.glb", name: "Widget v2" } } };
    const idb = new IDBFactory();
    await saveLastGlb("other.glb", new ArrayBuffer(8), idb);
    expect(await restoreLastDesign(custom, idb)).toBe(false);
    expect(s().part.id).toBe(initial.part.id);
    expect(s().settings).toEqual(initial.settings);
    expect(s().loadMessage).toContain("Load widget_v2.glb to reopen it.");
    expect(useLibrary.getState().pendingShare).toEqual(custom.design);
  });

  it("a kept GLB that can't be read falls back to the default part with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saved = savedCatalogCrate();
    const custom = { ...saved, design: { ...saved.design, part: { ...saved.design.part, source: "custom" as const, model: "widget_v2.glb" } } };
    const idb = new IDBFactory();
    await saveLastGlb("widget_v2.glb", new Uint8Array([1, 2, 3, 4]).buffer, idb);
    expect(await restoreLastDesign(custom, idb)).toBe(false);
    expect(s().part.id).toBe(initial.part.id);
    expect(warn).toHaveBeenCalled();
  });
});
