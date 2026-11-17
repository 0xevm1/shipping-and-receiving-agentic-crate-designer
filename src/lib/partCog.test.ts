import { readFileSync } from "node:fs";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { buildCogEstimate, meshTrianglesMm, scheduleCog, type CogOutcome } from "./partCog";
import { framedScene, MM_PER_UNIT, type PartFrame } from "./partFrame";

async function load(path: string): Promise<Object3D> {
  const b = readFileSync(path);
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "")).scene;
}

/** The estimate for a file read in `frame`, as the viewer does (turned Z up, then scaled). */
async function estimate(path: string, frame: PartFrame): Promise<CogOutcome> {
  return buildCogEstimate(framedScene(await load(path), frame.up), MM_PER_UNIT[frame.units]);
}

const offset = (o: CogOutcome): number[] => {
  if (!("offsetMm" in o)) throw new Error(`no estimate: ${o.fallback}`);
  return o.offsetMm;
};

const material = new MeshBasicMaterial();

describe("the mesh estimate on a loaded model", () => {
  it("reads a three.js box (a vertex per face) as closed, centred", () => {
    const scene = new Group().add(new Mesh(new BoxGeometry(0.3, 0.1, 0.2), material));
    offset(buildCogEstimate(scene, 1000)).forEach((v) => expect(v).toBeCloseTo(0, 6));
    expect(meshTrianglesMm(scene, 1000).length).toBe(12 * 9);
  });

  it("applies each mesh's own transform and the units", () => {
    // A 1 m cube at the origin (spans -0.5..0.5) and a 3 x 1 x 1 bar at x = 2.5 (spans 1..4), in one scene.
    const bar = new Mesh(new BoxGeometry(3, 1, 1), material);
    bar.position.set(2.5, 0, 0);
    const scene = new Group().add(new Mesh(new BoxGeometry(1, 1, 1), material), bar);
    // The box spans -0.5..4 (middle 1.75); the weight is (0 × 1 + 2.5 × 3) / 4 = 1.875: 125 mm toward +X.
    const [x, y, z] = offset(buildCogEstimate(scene, 1000));
    expect(x).toBeCloseTo(125, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("falls back for an open mesh", () => {
    // A single sheet has no volume to weigh; a box with its last faces cut off has holes.
    expect(buildCogEstimate(new Group().add(new Mesh(new PlaneGeometry(1, 1), material)), 1000)).toEqual({ fallback: "empty" });
    const cut = new BoxGeometry(1, 1, 1);
    cut.setIndex(Array.from(cut.getIndex()!.array).slice(0, 30));
    expect(buildCogEstimate(new Group().add(new Mesh(cut, material)), 1000)).toEqual({ fallback: "open" });
  });
});

describe("the mesh estimate on the sample parts and fixtures", () => {
  const SAMPLES = {
    "PART-001-machined-steel-bracket": [-38.32, 0, -48.57],
    "PART-002-long-steel-shaft": [-85.39, 0.12, 0],
    "PART-003-irregular-aluminum-housing": [-8.4, -7.97, -43.58],
  } as const;

  it.each(Object.entries(SAMPLES))("finds %s's centre away from its box centre", async (name, expected) => {
    const scene = await load(`public/parts/${name}.glb`);
    const started = performance.now();
    const found = offset(buildCogEstimate(scene, 1000));
    const ms = performance.now() - started;
    found.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 1));
    // A few ms for ~1,000 triangles; the bound only catches an accidental quadratic.
    expect(ms).toBeLessThan(500);
  });

  const BRACKET = [-38.32, 0, -48.57];
  it.each([
    ["bracket-metres", { units: "m", up: "z" }],
    ["bracket-millimetres", { units: "mm", up: "z" }],
    ["bracket-inches", { units: "in", up: "z" }],
    ["bracket-y-up", { units: "m", up: "y" }],
    ["bracket-off-origin", { units: "m", up: "z" }],
  ] as const)("gives the same centre for %s read in its frame", async (file, frame) => {
    const found = offset(await estimate(`fixtures/units-axis/${file}.glb`, frame));
    found.forEach((v, i) => expect(v).toBeCloseTo(BRACKET[i], 1));
  });

  it("finds the lopsided fixture's weight toward its block", async () => {
    const found = offset(await estimate("fixtures/scenarios/lopsided.glb", { units: "m", up: "z" }));
    expect(found[0]).toBeGreaterThan(250);
  });
});

describe("scheduleCog", () => {
  it("estimates once, off the call, and reuses the answer for the model", async () => {
    const scene = new Group().add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2), material));
    const first = await new Promise<CogOutcome>((resolve) => scheduleCog("/parts/schedule-test.glb", scene, 1000, (_, o) => resolve(o), "m/z"));
    expect("offsetMm" in first).toBe(true);
    let sync: CogOutcome | null = null;
    scheduleCog("/parts/schedule-test.glb", scene, 1000, (_, o) => (sync = o), "m/z");
    expect(sync).toBe(first); // from the model's memo, without a second run
  });

  it("can be cancelled before it runs", async () => {
    const scene = new Group().add(new Mesh(new BoxGeometry(1, 1, 1), material));
    let called = false;
    const cancel = scheduleCog("/parts/cancel-test.glb", scene, 1000, () => (called = true), "m/z");
    cancel();
    await new Promise((r) => setTimeout(r, 120));
    expect(called).toBe(false);
  });
});
