import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GLB_MESSAGES, glbProblem, glbSizeUnits, looksLikeTextGltf } from "./glb";
import { readFrame } from "./partFrame";

const sample = (name: string) => new Uint8Array(readFileSync(`public/parts/${name}`));

/** A GLB with the given JSON, optional BIN chunk and header overrides. */
function glb(json: object, opts: { version?: number; declaredExtra?: number } = {}): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(20 + padded).fill(0x20, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, opts.version ?? 2, true);
  view.setUint32(8, bytes.byteLength + (opts.declaredExtra ?? 0), true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  return bytes;
}

const box = (min: number[], max: number[], node: object = {}) => ({
  asset: { version: "2.0" },
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, ...node }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min, max }],
});

describe("glbProblem", () => {
  it("accepts the sample parts, as ArrayBuffer or Uint8Array", () => {
    const bytes = sample("PART-001-machined-steel-bracket.glb");
    expect(glbProblem(bytes)).toBeNull();
    expect(glbProblem(bytes.slice().buffer)).toBeNull();
  });

  it("rejects non-GLB data, damaged headers and chunks, and compression", () => {
    expect(glbProblem(new TextEncoder().encode('{"asset":{}}'))).toBe(GLB_MESSAGES.notGlb);
    expect(glbProblem(glb({ asset: {} }, { version: 1 }))).toBe(GLB_MESSAGES.damaged);
    expect(glbProblem(glb({ asset: {} }, { declaredExtra: 8 }))).toBe(GLB_MESSAGES.damaged);
    const truncated = glb({ asset: {} });
    new DataView(truncated.buffer).setUint32(12, 4096, true);
    expect(glbProblem(truncated)).toBe(GLB_MESSAGES.damaged);
    expect(glbProblem(glb({ asset: {}, extensionsRequired: ["KHR_draco_mesh_compression"] }))).toBe(GLB_MESSAGES.compressed);
    expect(glbProblem(glb({ asset: {}, extensionsRequired: ["EXT_meshopt_compression"] }))).toBe(GLB_MESSAGES.compressed);
  });
});

describe("looksLikeTextGltf", () => {
  it("spots JSON, with or without leading whitespace or a BOM, and not a GLB", () => {
    expect(looksLikeTextGltf(new TextEncoder().encode('  \n{"asset":{}}'))).toBe(true);
    expect(looksLikeTextGltf(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b]))).toBe(true);
    expect(looksLikeTextGltf(sample("PART-002-long-steel-shaft.glb"))).toBe(false);
    expect(looksLikeTextGltf(new Uint8Array())).toBe(false);
  });
});

describe("glbSizeUnits", () => {
  it("measures a primitive's bounds through its node's transform", () => {
    expect(glbSizeUnits(glb(box([-1, -2, -3], [1, 2, 3])))).toEqual([2, 4, 6]);
    expect(glbSizeUnits(glb(box([0, 0, 0], [1, 2, 3], { scale: [2, 2, 2], translation: [5, 5, 5] })))).toEqual([2, 4, 6]);
    const quarterTurnZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const turned = glbSizeUnits(glb(box([0, 0, 0], [1, 2, 3], { rotation: quarterTurnZ })))!;
    expect(turned.map((v) => Number(v.toFixed(9)))).toEqual([2, 1, 3]);
  });

  it("is null when there is no geometry", () => {
    expect(glbSizeUnits(glb({ asset: {} }))).toBeNull();
    expect(glbSizeUnits(new TextEncoder().encode("nope"))).toBeNull();
  });

  it("reads a measured size as the app does: units guessed from the size, Z up, unless chosen (spec §4)", () => {
    expect(readFrame([0.3, 0.2, 0.1])).toEqual({ frame: { units: "m", up: "z" }, guessed: true, sizeMm: [300, 200, 100] });
    expect(readFrame([12, 8, 4])).toEqual({ frame: { units: "in", up: "z" }, guessed: true, sizeMm: [304.8, 203.2, 101.6] });
    expect(readFrame([300, 200, 100])).toEqual({ frame: { units: "mm", up: "z" }, guessed: true, sizeMm: [300, 200, 100] });
    // Chosen: millimetres, Y up (the file's Y is the part's height).
    expect(readFrame([300, 100, 200], { units: "mm", up: "y" })).toEqual({ frame: { units: "mm", up: "y" }, guessed: false, sizeMm: [300, 200, 100] });
  });
});
