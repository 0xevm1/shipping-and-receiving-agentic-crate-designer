import { readFileSync } from "node:fs";
import { metricText as metric } from "@/lib/message";
import { Group, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parts } from "@/domain/catalog";
import { SHAPED_BLOCK } from "@/domain/crate";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { FACE_AXES, type FaceId, type PartProfile } from "@/domain/profile";
import { buildPartProfile, profileCellMm, scheduleProfile } from "./partProfile";

const FILES = {
  "PART-001": "PART-001-machined-steel-bracket.glb",
  "PART-002": "PART-002-long-steel-shaft.glb",
  "PART-003": "PART-003-irregular-aluminum-housing.glb",
} as const;

async function load(id: keyof typeof FILES): Promise<Object3D> {
  const b = readFileSync(`public/parts/${FILES[id]}`);
  const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "");
  return gltf.scene;
}

/** Depth on `face` at (u, v) mm from the bounding box's min corner along the face's axes. */
function depthAt(p: PartProfile, face: FaceId, u: number, v: number): number {
  const [ua, va] = FACE_AXES["xyz".indexOf(face[1]) as 0 | 1 | 2];
  const f = p.faces[face];
  const col = Math.floor((u / p.sizeMm[ua]) * f.cols);
  const row = Math.floor((v / p.sizeMm[va]) * f.rows);
  return f.depth[row * f.cols + col];
}

const scenes = {} as Record<keyof typeof FILES, Object3D>;
beforeAll(async () => {
  for (const id of Object.keys(FILES) as (keyof typeof FILES)[]) scenes[id] = await load(id);
});

describe("buildPartProfile (#16)", () => {
  it("measures the open-top housing from each side", () => {
    const p = buildPartProfile(scenes["PART-003"], 1000);
    expect(p.sizeMm).toEqual([435, 445, 254]);
    expect(p.cellMm).toBe(4.5);
    expect([p.faces["-x"].cols, p.faces["-x"].rows, p.faces["-y"].cols, p.faces["+z"].rows]).toEqual([99, 56, 97, 99]);
    // The model's min corner is (−215, −230, 0) mm.
    const y0 = 230;
    const x0 = 215;
    expect(depthAt(p, "-x", y0, 17)).toBe(0); // the base plate is the full length
    expect(depthAt(p, "-x", y0, 100)).toBe(26); // the end wall at x = −189 above it
    expect(depthAt(p, "-x", y0, 245)).toBe(-1); // above the walls: nothing in the way
    expect(depthAt(p, "+y", x0, 100)).toBe(72.5); // the side wall at y = 142.5, from the bounding face at 215
    expect(depthAt(p, "-y", x0 + 25, 100)).toBe(0); // the boss that sticks out to y = −230
    expect(depthAt(p, "+z", x0, y0)).toBe(219); // down through the open top to the base plate (35 mm)
    expect(depthAt(p, "-z", x0, y0)).toBe(0);
  });

  it("measures the bracket and the shaft", () => {
    const bracket = buildPartProfile(scenes["PART-001"], 1000);
    expect(bracket.sizeMm).toEqual([360, 220, 258]);
    // The upright plate at x = −142…−108 rises above the base; seen from −X it is set back 38 mm.
    expect(depthAt(bracket, "-x", 110, 200)).toBe(38);
    const shaft = buildPartProfile(scenes["PART-002"], 1000);
    expect(shaft.sizeMm).toEqual([1530, 172, 172]);
    expect(shaft.cellMm).toBe(15.5);
  });

  it("runs well under 200 ms per sample part", () => {
    for (const id of Object.keys(FILES) as (keyof typeof FILES)[]) {
      const t = performance.now();
      buildPartProfile(scenes[id], 1000);
      expect(performance.now() - t).toBeLessThan(200);
    }
  });

  it("grid spacing follows the part size", () => {
    expect(profileCellMm([435, 445, 254])).toBe(4.5);
    expect(profileCellMm([50, 40, 30])).toBe(2);
  });

  it("fails on a model with no geometry or past its time budget", () => {
    expect(() => buildPartProfile(new Group(), 1000)).toThrow();
    expect(() => buildPartProfile(scenes["PART-003"], 1000, -1)).toThrow(/too long/);
  });

  it("reports a failed analysis as null, so blocking stays on the bounding box", async () => {
    const result = await new Promise<PartProfile | null | undefined>((resolve) => {
      scheduleProfile("test://empty", new Group(), 1000, (_url, profile) => resolve(profile));
    });
    expect(result).toBeNull();
  });

  it("can be cancelled before it runs", async () => {
    let called = false;
    const cancel = scheduleProfile("test://cancelled", scenes["PART-001"], 1000, () => (called = true));
    cancel();
    await new Promise((r) => setTimeout(r, 100));
    expect(called).toBe(false);
  });
});

describe("restraint for PART-003 × 8 (#16)", () => {
  it("shaped blocking touches far more of the part and leaves it no free movement", () => {
    const part = parts.find((p) => p.id === "PART-003")!;
    const settings = { ...DEFAULT_SETTINGS, quantity: 8 };
    const profile = buildPartProfile(scenes["PART-003"], 1000);
    const plain = computeDesign(part, settings).design!;
    const d = computeDesign({ ...part, profile }, settings).design!;

    // Same crate: shaping changes only what is inside it.
    expect(d.layout.key).toBe(plain.layout.key);
    expect(d.layout.external).toEqual(plain.layout.external);
    const s = d.shapedBlocking!;
    expect(Math.round(s.boundingBox.contact * 100)).toBe(10);
    expect(Math.round(s.shaped.contact * 100)).toBe(63);
    expect(s.boundingBox.freeMm.map(Math.round)).toEqual([65, 5]);
    expect(s.shaped.freeMm).toEqual([0, 0]);
    expect(s.blocks).toBe(44);
    expect(d.members.filter((m) => m.label === SHAPED_BLOCK)).toHaveLength(44);
    expect(metric(d.checks.find((c) => c.id === "blocking")!.detail)).toBe(
      "24 blocking posts hold the parts on all four sides. They are shaped to the part with 44 shaped blocks in its recesses: " +
        "63% of the blocking face touches it (bounding box: 10%), and the most a part can shift is 0 mm (bounding box: 65 mm). " +
        "The smallest gap is 50 mm, between parts.",
    );
  });
});
