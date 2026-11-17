import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glbProblem, nameFromFile, partsFromJson } from "./loadPart";

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
