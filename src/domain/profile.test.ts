import { Euler, Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import { parts } from "./catalog";
import { designCrate, SHAPED_BLOCK, type Member } from "./crate";
import { computeDesign, DEFAULT_SETTINGS, type DesignPart } from "./design";
import { ORIENTATIONS } from "./orientations";
import {
  FACE_AXES,
  FACE_IDS,
  isSlenderForBlocking,
  MAX_SHAPED_BLOCK_DEPTH_MM,
  rotationMatrix,
  sideGrid,
  usableProfile,
  type FaceId,
  type PartProfile,
} from "./profile";
import type { Vec3 } from "./schema";

/**
 * A synthetic profile on a `cell`-mm grid. Every face is flat (depth 0) unless `shape` gives a
 * depth (mm, or -1 for an opening) at a cell centre (u, v, in mm along the face's axes).
 */
function profileOf(size: Vec3, shape: Partial<Record<FaceId, (u: number, v: number) => number>> = {}, cell = 5): PartProfile {
  const faces = {} as PartProfile["faces"];
  for (const id of FACE_IDS) {
    const [ua, va] = FACE_AXES["xyz".indexOf(id[1]) as 0 | 1 | 2];
    const cols = Math.round(size[ua] / cell);
    const rows = Math.round(size[va] / cell);
    const depth: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) depth.push(shape[id]?.(((c + 0.5) * size[ua]) / cols, ((r + 0.5) * size[va]) / rows) ?? 0);
    }
    faces[id] = { cols, rows, depth };
  }
  return { version: 1, sizeMm: size, cellMm: cell, faces };
}

const blocking = (members: Member[]) => members.filter((m) => m.kind === "blocking");
const custom = (size: Vec3, profile?: PartProfile): DesignPart => ({ id: "X", name: "Test part", mass_kg: 10, dimensions_mm: size, profile });
const one = { ...DEFAULT_SETTINGS, quantity: 1 };

describe("profile rotation", () => {
  it("matches three.js for every orientation", () => {
    for (const o of ORIENTATIONS) {
      const e = new Matrix4().makeRotationFromEuler(new Euler(...o.euler)).elements; // column-major
      const m = rotationMatrix(o);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m[r][c]).toBeCloseTo(e[c * 4 + r], 9);
    }
  });

  it("shows the part face that looks out each side of the slot", () => {
    // Only the part's +Z face is recessed (by 40 mm). Lying on its side (π/2 about X), it faces −Y.
    const size: Vec3 = [300, 200, 100];
    const profile = profileOf(size, { "+z": () => 40 });
    const onSide = ORIENTATIONS.find((o) => o.id === "on-side-x")!;
    const cellSize: Vec3 = [300, 100, 200];
    expect(sideGrid(profile, { orientation: onSide, cellSize }, { axis: 1, high: false }).depth.every((d) => d === 40)).toBe(true);
    expect(sideGrid(profile, { orientation: onSide, cellSize }, { axis: 1, high: true }).depth.every((d) => d === 0)).toBe(true);
    const upright = ORIENTATIONS[0];
    expect(sideGrid(profile, { orientation: upright, cellSize: size }, { axis: 1, high: false }).depth.every((d) => d === 0)).toBe(true);
  });
});

describe("shaped blocking (#16)", () => {
  const size: Vec3 = [400, 300, 200];

  it("a box-shaped profile reproduces the bounding-box blocking exactly", () => {
    for (const p of parts.filter((p) => !isSlenderForBlocking(p.dimensions_mm))) {
      for (const quantity of p.suggested_quantities) {
        const settings = { ...DEFAULT_SETTINGS, quantity };
        const plain = computeDesign(p, settings).design!;
        const boxed = computeDesign({ ...p, profile: profileOf(p.dimensions_mm) }, settings).design!;
        expect(boxed.members).toEqual(plain.members);
        expect(boxed.shapedBlocking!.shaped).toEqual({ contact: 1, freeMm: [0, 0] });
      }
    }
  });

  it("an L-shaped side gets a shaped block in the notch", () => {
    // The −X face steps back 60 mm above half height (an L seen from the end).
    const profile = profileOf(size, { "-x": (_y, z) => (z > 100 ? 60 : 0) });
    const d = designCrate(custom(size, profile), one, computeDesign(custom(size), one).design!.layout);
    const [slot] = d.layout.slots;
    const shaped = blocking(d.members).filter((m) => m.label === SHAPED_BLOCK);
    expect(shaped).toHaveLength(1);
    expect(shaped[0].min[0]).toBe(slot.min[0]);
    expect(shaped[0].size[0]).toBe(60);
    // It starts half a cell (2.5 mm) above the step: the step lies somewhere between two samples.
    expect(shaped[0].min[2]).toBeCloseTo(slot.min[2] + 102.5, 6);
    expect(shaped[0].size[2]).toBeCloseTo(97.5, 6);
    // The block touches the whole notch: every cell beside the part touches it, nothing can slide.
    expect(d.shapedBlocking).toMatchObject({ blocks: 1, shaped: { contact: 1, freeMm: [0, 0] } });
    // The bounding-box post still touches the lower half, so it stops the part too, but over less of its face.
    expect(d.shapedBlocking!.boundingBox).toMatchObject({ freeMm: [0, 0] });
    expect(d.shapedBlocking!.boundingBox.contact).toBeCloseTo(0.875, 3); // the notch is 1/8 of the blocking face
    expect(d.checks.find((c) => c.id === "blocking")!.detail).toContain(
      "They are shaped to the part with 1 shaped block in its recesses: 100% of the blocking face touches it (bounding box: 88%), and the most a part can shift is 0 mm (bounding box: 0 mm).",
    );
  });

  it("moves a post off an opening onto solid material", () => {
    // A window right through the part, 100–220 mm along the −Y face: the centred post (155.5–244.5) would sit over it.
    const window = (x: number) => (x > 100 && x < 220 ? -1 : 0);
    const profile = profileOf(size, { "-y": window, "+y": window });
    const plain = computeDesign(custom(size), one).design!;
    const d = designCrate(custom(size, profile), one, plain.layout);
    const [slot] = d.layout.slots;
    const post = blocking(d.members).find((m) => m.min[1] < slot.min[1])!;
    const x0 = post.min[0] - slot.min[0];
    expect(x0 >= 220 || x0 + post.size[0] <= 100).toBe(true);
    // Still as near the centre as it can be: just past the window.
    expect(x0).toBeCloseTo(220, 0);
    expect(d.shapedBlocking!.shaped.contact).toBeGreaterThan(d.shapedBlocking!.boundingBox.contact);
  });

  it("leaves recesses deeper than the limit alone", () => {
    const profile = profileOf(size, { "-x": (_y, z) => (z > 100 ? MAX_SHAPED_BLOCK_DEPTH_MM + 20 : 0) });
    const d = designCrate(custom(size, profile), one, computeDesign(custom(size), one).design!.layout);
    expect(blocking(d.members).filter((m) => m.label === SHAPED_BLOCK)).toHaveLength(0);
  });

  it("keeps shaped blocks on neighbouring sides apart", () => {
    // Every vertical face is set back 50 mm all over: blocks from −X and −Y must not meet at the corner.
    const deep = () => 50;
    const profile = profileOf([200, 200, 200], { "-x": deep, "+x": deep, "-y": deep, "+y": deep });
    const d = computeDesign(custom([200, 200, 200], profile), { ...DEFAULT_SETTINGS, quantity: 4 }).design!;
    const shaped = blocking(d.members).filter((m) => m.label === SHAPED_BLOCK);
    expect(shaped.length).toBeGreaterThan(0);
    for (const a of shaped) {
      for (const b of shaped) {
        if (a === b) continue;
        const overlap = [0, 1, 2].every((i) => a.min[i] < b.min[i] + b.size[i] - 0.01 && b.min[i] < a.min[i] + a.size[i] - 0.01);
        expect(overlap).toBe(false);
      }
    }
  });

  it("falls back to bounding-box blocking without a usable profile", () => {
    const plain = computeDesign(custom(size), one).design!;
    // Measured on a different size (another model), or a slender part: ignored.
    const wrong = profileOf([410, 300, 200], { "-x": () => 30 });
    expect(usableProfile(custom(size, wrong))).toBeNull();
    const d = computeDesign(custom(size, wrong), one).design!;
    expect(d.members).toEqual(plain.members);
    expect(d.shapedBlocking).toBeUndefined();
    expect(d.checks).toEqual(plain.checks);

    const shaft = parts.find((p) => p.id === "PART-002")!;
    expect(isSlenderForBlocking(shaft.dimensions_mm)).toBe(true);
    const shaftProfile = profileOf(shaft.dimensions_mm, { "-y": () => 20 }, 10);
    expect(computeDesign({ ...shaft, profile: shaftProfile }, DEFAULT_SETTINGS).design!.members).toEqual(
      computeDesign(shaft, DEFAULT_SETTINGS).design!.members,
    );
  });

  it("does not change the design without a profile", () => {
    const p3 = parts.find((p) => p.id === "PART-003")!;
    const d = computeDesign(p3, { ...DEFAULT_SETTINGS, quantity: 8 }).design!;
    expect(d.shapedBlocking).toBeUndefined();
    expect(blocking(d.members).every((m) => m.label === "Blocking post")).toBe(true);
    expect(d.checks.find((c) => c.id === "blocking")!.detail).toBe(
      "24 blocking posts hold the parts on all four sides. The smallest gap is 50 mm, between parts.",
    );
  });
});
