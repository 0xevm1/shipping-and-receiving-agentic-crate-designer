import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "@/domain/catalog";
import { useLibrary } from "./libraryStore";
import { loadPickedFiles } from "./partLoader";
import { catalogPart, useDesigner } from "./store";

const loadPartFiles = vi.fn();
const loadDesign = vi.fn();
vi.mock("@/lib/loadPart", () => ({
  loadPartFiles: (...a: unknown[]) => loadPartFiles(...a),
  loadDesign: (...a: unknown[]) => loadDesign(...a),
}));

const initial = useDesigner.getState();
const file = (name: string) => ({ name }) as File;
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const outcomeFor = (id: string, modelUrl = "/x.glb") => ({
  catalogAdditions: [],
  message: id,
  part: { ...catalogPart(catalog.parts.find((p) => p.id === id) ?? catalog.parts[0]), id, modelUrl },
});

describe("load ordering", () => {
  beforeEach(() => {
    useDesigner.setState(initial, true);
    loadPartFiles.mockReset();
    loadDesign.mockReset();
  });
  afterEach(() => useLibrary.getState().setPendingShare(null));

  it("a slow load that finishes after a later quick one does not overwrite it", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    const slow = deferred<ReturnType<typeof outcomeFor>>();
    loadPartFiles.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(outcomeFor("quick"));
    const first = loadPickedFiles([file("slow.glb")]);
    await loadPickedFiles([file("quick.glb")]);
    expect(useDesigner.getState().part.id).toBe("quick");
    slow.resolve(outcomeFor("slow", "blob:slow"));
    await first;
    expect(useDesigner.getState().part.id).toBe("quick");
    expect(useDesigner.getState().loadMessage).toBe("quick");
    expect(revoke).toHaveBeenCalledWith("blob:slow");
    vi.unstubAllGlobals();
  });

  it("a failure of a superseded load says nothing", async () => {
    let fail!: (e: Error) => void;
    const slow = new Promise<never>((_, reject) => (fail = reject));
    loadPartFiles.mockReturnValueOnce(slow).mockResolvedValueOnce(outcomeFor("quick"));
    const first = loadPickedFiles([file("slow.glb")]);
    await loadPickedFiles([file("quick.glb")]);
    fail(new Error("slow.glb is broken"));
    await first;
    expect(useDesigner.getState().loadMessage).toBe("quick");
  });

  it("keeps a waiting shared design until its model has opened it", async () => {
    const pending = { part: { model: "w.glb" } } as never;
    useLibrary.getState().setPendingShare(pending);
    loadDesign.mockResolvedValueOnce({ message: "bad GLB" });
    await loadPickedFiles([file("w.glb")]);
    expect(useLibrary.getState().pendingShare).toBe(pending);
    loadDesign.mockResolvedValueOnce({ ...outcomeFor("quick"), design: { settings: initial.settings, layoutKey: null, crateIndex: 0, ranking: initial.ranking } });
    await loadPickedFiles([file("w.glb")]);
    expect(useLibrary.getState().pendingShare).toBeNull();
    expect(loadDesign).toHaveBeenCalledTimes(2);
  });
});
