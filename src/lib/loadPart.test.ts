import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parts } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { serializeDesign } from "@/domain/designFile";
import { catalogPart, type LoadedPart } from "@/state/store";
import { designFilePart, glbProblem, loadPartFiles, nameFromFile, partsFromJson } from "./loadPart";

const sample = (name: string) => {
  const b = readFileSync(`public/parts/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** A minimal GLB header + JSON chunk with the given JSON. */
function fakeGlb(json: object): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const buf = new ArrayBuffer(20 + padded);
  const view = new DataView(buf);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buf.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf, 20).set(text);
  new Uint8Array(buf, 20 + text.length).fill(0x20);
  return buf;
}

describe("glbProblem", () => {
  it("accepts the sample parts", () => {
    expect(glbProblem(sample("PART-002-long-steel-shaft.glb"))).toBeNull();
  });

  it("rejects non-GLB data and compressed files", () => {
    expect(glbProblem(new TextEncoder().encode('{"asset":{}}').buffer as ArrayBuffer)).toMatch(/not a .glb/);
    expect(glbProblem(fakeGlb({ asset: {}, extensionsRequired: ["KHR_draco_mesh_compression"] }))).toMatch(/Draco/);
    expect(glbProblem(fakeGlb({ asset: {}, extensionsRequired: ["EXT_meshopt_compression"] }))).toMatch(/Meshopt/);
  });
});

describe("file helpers", () => {
  it("names a part from its file", () => {
    expect(nameFromFile("PART-004-cast-iron-cover.glb")).toBe("Cast iron cover");
    expect(nameFromFile("widget_v2.glb")).toBe("Widget v2");
  });

  it("keeps only valid entries from a parts.json", () => {
    const text = readFileSync("src/data/parts.json", "utf8");
    expect(partsFromJson(text)).toHaveLength(3);
    expect(partsFromJson('{"parts":[{"id":"x"}]}')).toHaveLength(0);
  });
});

describe("design files (#28)", () => {
  const settings = { ...DEFAULT_SETTINGS, quantity: 8, maxLayers: 3 };
  const designJson = (part: LoadedPart) => {
    const design = computeDesign(part, settings).design!;
    return serializeDesign({ part: designFilePart(part), settings, layoutKey: design.layout.key, design, savedAt: "2026-11-16T00:00:00Z" });
  };
  const jsonFile = (text: string, name = "design.json") => new File([text], name, { type: "application/json" });
  const shaft = catalogPart(parts.find((p) => p.id === "PART-002")!);
  const custom: LoadedPart = {
    ...shaft,
    id: "widget_v2",
    name: "Widget",
    model: "widget_v2.glb",
    modelUrl: "blob:x",
    catalogDims: undefined,
  };

  it("marks bundled catalog parts as catalog and anything else as custom", () => {
    expect(designFilePart(shaft)).toMatchObject({ source: "catalog", id: "PART-002", model: "PART-002-long-steel-shaft.glb" });
    // The bundled model loaded from disk is still the catalog part.
    expect(designFilePart({ ...shaft, modelUrl: "blob:y" }).source).toBe("catalog");
    expect(designFilePart(custom)).toMatchObject({ source: "custom", model: "widget_v2.glb" });
    expect(designFilePart({ ...custom, massAssumed: true }).massAssumed).toBe(true);
  });

  it("restores a catalog design from the bundled catalog with its rules and layout", async () => {
    const out = await loadPartFiles([jsonFile(designJson(shaft))], parts);
    expect(out.part).toMatchObject({ id: "PART-002", modelUrl: "/parts/PART-002-long-steel-shaft.glb" });
    expect(out.design?.settings).toEqual(settings);
    expect(out.design?.layoutKey).toBe(computeDesign(shaft, settings).design!.layout.key);
    expect(out.message).toBe("Design loaded: 8 × Long steel shaft.");
    expect(out.catalogAdditions).toEqual([]);
  });

  it("names the model file a custom design needs, and changes nothing without it", async () => {
    const out = await loadPartFiles([jsonFile(designJson(custom))], parts);
    expect(out.part).toBeUndefined();
    expect(out.design).toBeUndefined();
    expect(out.message).toMatch(/custom model\. Add widget_v2\.glb together with the design file/);
  });

  it("still treats other JSON as a parts.json catalog", async () => {
    const out = await loadPartFiles([jsonFile(readFileSync("src/data/parts.json", "utf8"), "parts.json")], []);
    expect(out.catalogAdditions).toHaveLength(3);
    expect(out.message).toMatch(/Now add the .glb/);
  });

  it("reports a bad design file or bad JSON plainly", async () => {
    const bad = JSON.parse(designJson(shaft));
    bad.settings.quantity = 0;
    expect((await loadPartFiles([jsonFile(JSON.stringify(bad))], parts)).message).toMatch(/settings\.quantity/);
    expect((await loadPartFiles([jsonFile("{oops", "x.json")], parts)).message).toBe("x.json is not valid JSON.");
  });
});
