import { readdirSync, readFileSync } from "node:fs";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
// The reader is in the domain (pure); this test sits in lib because it checks it against three.js.
import { readGlb } from "@/domain/glbInfo";

const bytes = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** A .glb with one box mesh under a node with the given transform, for the node-transform cases. */
function glbWithNode(node: object, min = [0, 0, 0], max = [1, 2, 3]): ArrayBuffer {
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, ...node }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ componentType: 5126, count: 8, type: "VEC3", min, max }],
  };
  const body = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(body.length / 4) * 4;
  const out = new ArrayBuffer(20 + padded);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20).fill(0x20);
  new Uint8Array(out, 20).set(body);
  return out;
}

const size = (r: ReturnType<typeof readGlb>) => ("info" in r ? r.info.size : null);

describe("readGlb sizes", () => {
  it("carries a mesh through its node's scale, rotation and translation", () => {
    expect(size(readGlb(glbWithNode({})))).toEqual([1, 2, 3]);
    expect(size(readGlb(glbWithNode({ scale: [1000, 1000, 1000] })))).toEqual([1000, 2000, 3000]);
    // A quarter turn about X (Y to Z, Z to -Y): the 1 x 2 x 3 box becomes 1 x 3 x 2.
    const s = Math.SQRT1_2;
    const turned = size(readGlb(glbWithNode({ rotation: [s, 0, 0, s] })))!;
    expect(turned.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 3, 2]);
    const moved = readGlb(glbWithNode({ translation: [10, 20, 30] }));
    expect("info" in moved && moved.info.center).toEqual([10.5, 21, 31.5]);
    expect(size(readGlb(glbWithNode({ matrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] })))).toEqual([2, 2, 3]);
  });

  it("says no geometry for a mesh whose points can't be measured", () => {
    expect(readGlb(glbWithNode({}, null as never, null as never))).toEqual({ problem: { kind: "no-geometry" } });
  });

  it("gives the same size as three.js for every sample and fixture it can read", async () => {
    const files = [
      ...readdirSync("public/parts").map((f) => `public/parts/${f}`),
      ...["fixtures/scenarios", "fixtures/units-axis"].flatMap((d) =>
        readdirSync(d)
          .filter((f) => f.endsWith(".glb"))
          .map((f) => `${d}/${f}`),
      ),
    ];
    let compared = 0;
    for (const path of files) {
      const read = readGlb(bytes(path));
      if (!("info" in read)) continue;
      const gltf = await new GLTFLoader().parseAsync(bytes(path), "");
      const box = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
      read.info.size.forEach((v, i) => expect(v, `${path} axis ${i}`).toBeCloseTo([box.x, box.y, box.z][i], 4));
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe("readGlb problems", () => {
  const problem = (r: ReturnType<typeof readGlb>) => ("problem" in r ? r.problem : null);

  it.each([
    ["not-a-model.glb", { kind: "not-glb" }],
    ["renamed-gltf.glb", { kind: "not-glb", looksLike: "a text glTF" }],
    ["renamed-stl.glb", { kind: "not-glb", looksLike: "an STL file" }],
    ["old-version.glb", { kind: "version", version: 1 }],
    ["damaged.glb", { kind: "damaged" }],
    ["draco.glb", { kind: "compressed", extension: "Draco" }],
    ["meshopt.glb", { kind: "compressed", extension: "Meshopt" }],
    ["empty-scene.glb", { kind: "no-geometry" }],
    ["single-point.glb", { kind: "no-size" }],
    ["flat.glb", { kind: "flat", axis: 2 }],
  ])("%s", (name, expected) => {
    expect(problem(readGlb(bytes(`fixtures/scenarios/${name}`)))).toEqual(expected);
  });

  it("calls a file too short for a header not a .glb", () => {
    expect(problem(readGlb(new ArrayBuffer(4)))).toEqual({ kind: "not-glb", looksLike: undefined });
  });
});
