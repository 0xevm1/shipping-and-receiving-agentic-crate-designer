import { readFileSync } from "node:fs";
import { Box3, Mesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { planShipment } from "@/domain/shipment";
import { parts } from "@/domain/catalog";
import { buildCrateScene, PARTS_NODE } from "./exportGlb";
import { loadPartFiles } from "./loadPart";
import { framePart, type LoadedPart } from "./part";
import { FRAME_MATCH_MM, fitFrame, frameWords, framedScene, framedSizeMm, guessUnits, INCHES_FILE_MAX, METRES_FILE_MAX, MM_PER_UNIT } from "./partFrame";
import { buildPartProfile } from "./partProfile";

/**
 * Part files in other units and up axes (#105). The fixtures are PART-001 rewritten by
 * `scripts/fixtures/units-axis.mjs`; the crate they give, once read the right way, must be the
 * crate the original gives.
 */

const arrayBuffer = (path: string) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const fixture = (name: string) => `fixtures/units-axis/${name}`;
const sceneOf = async (path: string) => (await new GLTFLoader().parseAsync(arrayBuffer(path), "")).scene;
const fileOf = (path: string, name: string) => new File([arrayBuffer(path)], name, { type: "model/gltf-binary" });

const ORIGINAL = "public/parts/PART-001-machined-steel-bracket.glb";
const QUANTITY = 4;

/** A loaded fixture, read in the given frame, with its outline measured the way the viewer does. */
async function measuredPart(name: string, frame: { units: "m" | "mm" | "in"; up: "z" | "y" }): Promise<{ part: LoadedPart; scene: Object3D }> {
  const out = await loadPartFiles([fileOf(fixture(name), name)], []);
  const loaded = out.part!;
  const part = framePart(loaded, frame);
  const scene = framedScene(await sceneOf(fixture(name)), frame.up);
  // The user enters the real mass; the bracket weighs what the catalog says.
  return { part: { ...part, mass_kg: 21.5, profile: buildPartProfile(scene, part.mmPerUnit) }, scene };
}

const crateOf = (part: LoadedPart) => {
  const plan = planShipment(part, { ...DEFAULT_SETTINGS, quantity: QUANTITY });
  const result = plan.crates[0].result;
  return { plan, design: result.design!, layoutKey: result.design!.layout.key };
};

/** What the original bracket gives, the same way. */
async function original() {
  const scene = await sceneOf(ORIGINAL);
  const loaded = (await loadPartFiles([fileOf(ORIGINAL, "PART-001-machined-steel-bracket.glb")], parts)).part!;
  return { part: { ...loaded, profile: buildPartProfile(scene, loaded.mmPerUnit) }, scene };
}

describe("the guess", () => {
  it("reads metres up to 3 units, inches up to 20, millimetres beyond", () => {
    expect(guessUnits(0.36)).toBe("m");
    expect(guessUnits(METRES_FILE_MAX)).toBe("m");
    expect(guessUnits(METRES_FILE_MAX + 0.01)).toBe("in");
    expect(guessUnits(INCHES_FILE_MAX)).toBe("in");
    expect(guessUnits(INCHES_FILE_MAX + 0.01)).toBe("mm");
    expect(guessUnits(360)).toBe("mm");
  });
});

describe("framedSizeMm", () => {
  it("scales by the units and swaps the two other sides for Y up", () => {
    expect(framedSizeMm([1, 2, 3], { units: "m", up: "z" })).toEqual([1000, 2000, 3000]);
    expect(framedSizeMm([1, 2, 3], { units: "mm", up: "z" })).toEqual([1, 2, 3]);
    expect(framedSizeMm([1, 2, 3], { units: "in", up: "z" })).toEqual([25.4, 50.8, expect.closeTo(76.2, 9)]);
    expect(framedSizeMm([1, 2, 3], { units: "mm", up: "y" })).toEqual([1, 3, 2]);
  });

  it("agrees with measuring the turned scene", async () => {
    const raw = new Box3().setFromObject(await sceneOf(fixture("bracket-y-up.glb"))).getSize(new Vector3());
    const turned = new Box3().setFromObject(framedScene(await sceneOf(fixture("bracket-y-up.glb")), "y")).getSize(new Vector3());
    const [x, y, z] = framedSizeMm([raw.x, raw.y, raw.z], { units: "m", up: "y" });
    expect([x, y, z].map((v) => v / MM_PER_UNIT.m)).toEqual([turned.x, turned.y, turned.z].map((v) => expect.closeTo(v, 6)));
  });
});

describe("fitFrame", () => {
  it("finds the units and axis that give a known size, Z up first", () => {
    expect(fitFrame([0.36, 0.22, 0.258], [360, 220, 258])).toEqual({ units: "m", up: "z" });
    expect(fitFrame([360, 220, 258], [360, 220, 258])).toEqual({ units: "mm", up: "z" });
    expect(fitFrame([360 / 25.4, 220 / 25.4, 258 / 25.4], [360, 220, 258])).toEqual({ units: "in", up: "z" });
    expect(fitFrame([0.36, 0.258, 0.22], [360, 220, 258])).toEqual({ units: "m", up: "y" });
    expect(fitFrame([0.36, 0.22 + 2 * FRAME_MATCH_MM, 0.258], [360, 220, 258])).toBeNull();
  });
});

it("words a frame as a note does", () => {
  expect(frameWords({ units: "in", up: "y" })).toBe("inches, Y up");
});

describe("the same part in other units gives the same crate once the right units are picked", () => {
  it("is guessed as metres, inches or millimetres from the size, and wrong for some (the user picks)", async () => {
    const guess = async (name: string) => (await loadPartFiles([fileOf(fixture(name), name)], [])).part!;
    expect(await guess("bracket-metres.glb")).toMatchObject({ modelUnits: "m", unitsGuessed: true });
    // 14 in is under the 20-unit limit; 360 mm is over it: both guesses are right.
    expect(await guess("bracket-inches.glb")).toMatchObject({ modelUnits: "in", upAxis: "z" });
    expect(await guess("bracket-millimetres.glb")).toMatchObject({ modelUnits: "mm", upAxis: "z" });
    // A Y-up file is read Z up until the user says otherwise: it lies on its side.
    expect((await guess("bracket-y-up.glb")).dimensions_mm).not.toEqual([360, 220, 258].map((v) => expect.closeTo(v, 0)));
  });

  for (const [name, units] of [
    ["bracket-metres.glb", "m"],
    ["bracket-millimetres.glb", "mm"],
    ["bracket-inches.glb", "in"],
  ] as const) {
    it(`${name} read as ${units}: same size, outline, crate and cut list`, async () => {
      const want = await original();
      const got = await measuredPart(name, { units, up: "z" });
      got.part.dimensions_mm.forEach((v, i) => expect(v).toBeCloseTo(want.part.dimensions_mm[i], 1));
      expect(got.part.profile!.cellMm).toBe(want.part.profile!.cellMm);
      for (const face of Object.keys(want.part.profile!.faces) as (keyof NonNullable<LoadedPart["profile"]>["faces"])[]) {
        got.part.profile!.faces[face].depth.forEach((d, i) => expect(d).toBeCloseTo(want.part.profile!.faces[face].depth[i], 0));
      }
      const a = crateOf(got.part);
      const b = crateOf(want.part);
      expect(a.layoutKey).toBe(b.layoutKey);
      expect(a.design.layout.external.map(Math.round)).toEqual(b.design.layout.external.map(Math.round));
      expect(a.design.bom.map((l) => [l.key, l.qty])).toEqual(b.design.bom.map((l) => [l.key, l.qty]));
      expect(a.design.grossKg).toBeCloseTo(b.design.grossKg, 1);
    });
  }
});

describe("a Y-up copy of PART-001 gives the Z-up crate once Y up is picked, and stands upright", () => {
  it("measures the same size, outline and crate as the original", async () => {
    const want = await original();
    const got = await measuredPart("bracket-y-up.glb", { units: "m", up: "y" });
    got.part.dimensions_mm.forEach((v, i) => expect(v).toBeCloseTo(want.part.dimensions_mm[i], 1));
    // The profile's six faces are the original's: the bracket's upright wall is on the same side, not upside down.
    for (const face of Object.keys(want.part.profile!.faces) as (keyof NonNullable<LoadedPart["profile"]>["faces"])[]) {
      got.part.profile!.faces[face].depth.forEach((d, i) => expect(d).toBeCloseTo(want.part.profile!.faces[face].depth[i], 0));
    }
    const a = crateOf(got.part);
    const b = crateOf(want.part);
    expect(a.layoutKey).toBe(b.layoutKey);
    expect(a.design.layout.external.map(Math.round)).toEqual(b.design.layout.external.map(Math.round));
    expect(a.design.bom.map((l) => [l.key, l.qty])).toEqual(b.design.bom.map((l) => [l.key, l.qty]));
  });

  it("keeps the base plate at the bottom: its heavy side is on -Z, as in the original", async () => {
    const { scene } = await measuredPart("bracket-y-up.glb", { units: "m", up: "y" });
    scene.updateMatrixWorld(true);
    // The bracket is a 28 mm plate with a wall up to 258 mm: more of the metal is near the bottom.
    let low = 0;
    let high = 0;
    const box = new Box3().setFromObject(scene);
    const mid = (box.min.z + box.max.z) / 2;
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const b = new Box3().setFromObject(o);
      const volume = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
      if ((b.min.z + b.max.z) / 2 < mid) low += volume;
      else high += volume;
    });
    expect(low).toBeGreaterThan(high);
    expect(box.min.z).toBeCloseTo(0, 3);
  });

  it("picking Y up on a Z-up read re-measures: the size swaps its two other sides and the outline is dropped", async () => {
    const loaded = (await loadPartFiles([fileOf(fixture("bracket-y-up.glb"), "bracket-y-up.glb")], [])).part!;
    const lying = framePart({ ...loaded, profile: { version: 1 } as never }, { units: "m", up: "z" });
    expect(lying.profile).toBeUndefined();
    const upright = framePart(lying, { units: "m", up: "y" });
    expect(upright.dimensions_mm[2]).toBeCloseTo(lying.dimensions_mm[1], 6);
    expect(upright.dimensions_mm[1]).toBeCloseTo(lying.dimensions_mm[2], 6);
    expect(upright.upAxis).toBe("y");
  });
});

describe("a part far from the origin loads centred and measures correctly", () => {
  it("measures the same size and outline as the original, wherever the mesh sits", async () => {
    const want = await original();
    const loaded = (await loadPartFiles([fileOf(fixture("bracket-off-origin.glb"), "bracket-off-origin.glb")], [])).part!;
    expect(loaded.modelUnits).toBe("m");
    loaded.dimensions_mm.forEach((v, i) => expect(v).toBeCloseTo(want.part.dimensions_mm[i], 1));
    const scene = await sceneOf(fixture("bracket-off-origin.glb"));
    const profile = buildPartProfile(scene, loaded.mmPerUnit);
    expect(profile.sizeMm.map((v) => Math.round(v))).toEqual(want.part.profile!.sizeMm.map((v) => Math.round(v)));
    for (const face of Object.keys(want.part.profile!.faces) as (keyof typeof profile.faces)[]) {
      profile.faces[face].depth.forEach((d, i) => expect(d).toBeCloseTo(want.part.profile!.faces[face].depth[i], 0));
    }
  });

  it("sits on its slot in the exported crate, centred like the original", async () => {
    const centreOf = async (path: string, units: "m", up: "z") => {
      const scene = framedScene(await sceneOf(path), up);
      const part = (await loadPartFiles([fileOf(path, "x.glb")], [])).part!;
      const design = crateOf({ ...framePart(part, { units, up }), profile: undefined }).design;
      const root = buildCrateScene(design, { scene, mmPerUnit: MM_PER_UNIT[units] });
      root.updateMatrixWorld(true);
      const parts = root.getObjectByName(PARTS_NODE)!;
      return { box: new Box3().setFromObject(parts), design };
    };
    const a = await centreOf(fixture("bracket-off-origin.glb"), "m", "z");
    const b = await centreOf(ORIGINAL, "m", "z");
    expect(a.box.min.toArray().map((v) => v)).toEqual(b.box.min.toArray().map((v) => expect.closeTo(v, 3)));
    expect(a.box.max.toArray().map((v) => v)).toEqual(b.box.max.toArray().map((v) => expect.closeTo(v, 3)));
    // The parts stay inside the crate's own outline: nowhere near the 50 m offset.
    const half = a.design.layout.external.map((v) => v / 2000);
    expect(Math.abs(a.box.max.x)).toBeLessThan(half[0] + 0.01);
  });
});
