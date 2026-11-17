import { readFileSync } from "node:fs";
import { Box3, Mesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { ASSEMBLIES } from "@/domain/crate";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { ASSEMBLY_NAMES } from "@/domain/assemblyNames";
import { glbProblem } from "./loadPart";
import { buildCrateScene, crateCentreMm, CRATE_NODE, exportCrateGlb, PARTS_NODE, type PartModel } from "./exportGlb";

/**
 * GLTFExporter's binary path reads its Blobs with FileReader, which node lacks. A minimal
 * stand-in (readAsArrayBuffer + onloadend) is enough; Blob itself is built into node.
 */
beforeAll(() => {
  if (typeof globalThis.FileReader !== "undefined") return;
  class NodeFileReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((b) => {
        this.result = b;
        this.onloadend?.();
      });
    }
  }
  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
});

const asArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const parse = (glb: ArrayBuffer) => new GLTFLoader().parseAsync(glb, "");

async function sampleModel(model: string): Promise<Object3D> {
  return (await parse(asArrayBuffer(readFileSync(`public/parts/${model}`)))).scene;
}

function design(id: string, quantity: number) {
  const p = getPart(id);
  const d = computeDesign(p, { ...DEFAULT_SETTINGS, quantity }).design;
  if (!d) throw new Error("no design");
  return d;
}

/** Bounds of everything except the Parts node, in the file's units (metres). */
function crateBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (let p = o.parent; p; p = p.parent) if (p.name === PARTS_NODE) return;
    box.union(new Box3().setFromObject(o));
  });
  return box;
}

/** The name as written in the file: GLTFLoader swaps spaces for "_" in `name` and keeps the original in `userData.name`. */
const fileName = (o: Object3D): string => o.userData.name ?? o.name;

const meshes = (o: Object3D) => {
  const out: Mesh[] = [];
  o.traverse((c) => {
    if (c instanceof Mesh) out.push(c);
  });
  return out;
};

describe("GLB export (#27)", () => {
  for (const [id, model, qty] of [
    ["PART-001", "PART-001-machined-steel-bracket.glb", 4],
    ["PART-002", "PART-002-long-steel-shaft.glb", 8],
    ["PART-003", "PART-003-irregular-aluminum-housing.glb", 1],
  ] as const) {
    it(`round-trips ${id} × ${qty}: outside size in metres, Z up, named boards and parts`, async () => {
      const d = design(id, qty);
      const part: PartModel = { scene: await sampleModel(model), mmPerUnit: 1000, material: getPart(id).material };
      const glb = await exportCrateGlb(d, part);

      expect(glb.byteLength).toBeGreaterThan(0);
      expect(glbProblem(glb)).toBeNull();
      const back = (await parse(glb)).scene;

      // Outside size within 1 mm, in metres. X/Y/Z map straight to L/W/H: no Y-up rotation.
      const size = crateBounds(back).getSize(new Vector3());
      const [L, W, H] = d.layout.external;
      expect(Math.abs(size.x - L / 1000)).toBeLessThan(0.001);
      expect(Math.abs(size.y - W / 1000)).toBeLessThan(0.001);
      expect(Math.abs(size.z - H / 1000)).toBeLessThan(0.001);

      // Node tree: Crate → assemblies (non-empty ones, in build order) + Parts.
      const crate = back.getObjectByName(CRATE_NODE)!;
      expect(crate).toBeDefined();
      const expectedGroups = ASSEMBLIES.filter((a) => d.members.some((m) => m.assembly === a)).map((a) => ASSEMBLY_NAMES[a]);
      expect(crate.children.map(fileName)).toEqual([...expectedGroups, PARTS_NODE]);

      // One mesh per board, named "{label} {n}", unique.
      const boards = crateMeshes(crate);
      expect(boards).toHaveLength(d.members.length);
      const names = boards.map(fileName);
      expect(new Set(names).size).toBe(names.length);
      expect(names).toContain("Side rail 1");
      expect(names).toContain("Side rail 4");
      expect(names).toContain("Floor 1");
      for (const n of names) expect(n).toMatch(/^[A-Z][a-z ]+ \d+$/);

      // Named wood materials.
      expect(boards.every((m) => /^Wood /.test((m.material as { name: string }).name))).toBe(true);

      // The crate's centre is the file's origin (#81), so viewers turn it about its own middle.
      const centre = crateBounds(back).getCenter(new Vector3());
      expect(centre.length()).toBeLessThan(0.0005);

      // Parts: one per slot, "Part 1…N", each inside the crate's outside box.
      const parts = back.getObjectByName(PARTS_NODE)!;
      expect(parts.children.map(fileName)).toEqual(Array.from({ length: qty }, (_, i) => `Part ${i + 1}`));
      const outside = crateBounds(back).expandByScalar(0.001);
      for (const p of parts.children) expect(outside.containsBox(new Box3().setFromObject(p))).toBe(true);
    });
  }

  it("groups boards under Base, Side walls, End walls, Lid and Inside the crate", () => {
    const crate = buildCrateScene(design("PART-001", 4)).getObjectByName(CRATE_NODE)!;
    expect(crate.children.map((c) => c.name)).toEqual(["Base", "Side walls", "End walls", "Lid", "Inside the crate"]);
  });

  it("leaves the parts out when asked", async () => {
    const back = (await parse(await exportCrateGlb(design("PART-001", 4), null))).scene;
    expect(back.getObjectByName(PARTS_NODE)).toBeUndefined();
  });

  it("places each part where the packer put it, relative to the centred crate", async () => {
    const d = design("PART-002", 8);
    const scene = buildCrateScene(d, { scene: await sampleModel("PART-002-long-steel-shaft.glb"), mmPerUnit: 1000 });
    scene.updateMatrixWorld(true);
    const parts = scene.getObjectByName(PARTS_NODE)!;
    const [ox, oy, oz] = crateCentreMm(d);
    d.layout.slots.forEach((slot, i) => {
      const c = new Box3().setFromObject(parts.children[i]).getCenter(new Vector3());
      const [a, b, cz] = d.layout.cellSize;
      expect(c.x).toBeCloseTo((slot.min[0] + a / 2 - ox) / 1000, 4);
      expect(c.y).toBeCloseTo((slot.min[1] + b / 2 - oy) / 1000, 4);
      expect(c.z).toBeCloseTo((slot.min[2] + cz / 2 - oz) / 1000, 4);
    });
  });

  it("centres the crate on the origin, also without parts (#81)", () => {
    const scene = buildCrateScene(design("PART-001", 4));
    scene.updateMatrixWorld(true);
    expect(new Box3().setFromObject(scene).getCenter(new Vector3()).length()).toBeLessThan(0.0005);
  });
});

function crateMeshes(crate: Object3D): Mesh[] {
  return crate.children.filter((c) => c.name !== PARTS_NODE).flatMap(meshes);
}
