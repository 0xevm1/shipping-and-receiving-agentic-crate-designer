import { describe, expect, it } from "vitest";
import { catalog } from "@/domain/catalog";
import { models } from "@/lib/modelRegistry";
import { catalogPart, type LoadedPart } from "@/lib/part";
import { useDesigner } from "./store";

const base = catalogPart(catalog.parts[0]);
/** A custom part on a model the registry owns, and the loader's hold on it. */
const loaded = (): { part: LoadedPart; url: string; hold: { release: () => void } } => {
  const { url, hold } = models.adopt(new Blob(["glb"]));
  return { part: { ...base, id: url, modelUrl: url }, url, hold };
};
const alive = (url: string) => models.blob(url) !== null;

describe("the part on screen holds its model", () => {
  it("keeps it after the loader lets go, and frees it when the part is replaced", () => {
    const a = loaded();
    useDesigner.getState().setPart(a.part);
    a.hold.release();
    expect(alive(a.url)).toBe(true);

    const b = loaded();
    useDesigner.getState().setPart(b.part);
    b.hold.release();
    expect(alive(a.url)).toBe(false);
    expect(alive(b.url)).toBe(true);

    useDesigner.getState().setPart(base);
    expect(alive(b.url)).toBe(false);
  });

  it("keeps the old model while something else still holds it (an export, the viewer, the saver)", () => {
    const a = loaded();
    useDesigner.getState().setPart(a.part);
    a.hold.release();
    const export_ = models.acquire(a.url);
    useDesigner.getState().setPart(base);
    expect(alive(a.url)).toBe(true);
    export_.release();
    expect(alive(a.url)).toBe(false);
  });

  it("editing the part without changing its model frees nothing", () => {
    const a = loaded();
    useDesigner.getState().setPart(a.part);
    a.hold.release();
    useDesigner.getState().setPartProfile(a.url, null);
    useDesigner.setState((s) => ({ part: { ...s.part, name: "Renamed" } }));
    expect(alive(a.url)).toBe(true);
    useDesigner.getState().setPart(base);
  });
});
