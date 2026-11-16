import { describe, expect, it } from "vitest";
import { parts } from "./catalog";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { ORIENTATIONS, rotatedSize } from "./orientations";
import type { Vec3 } from "./schema";

describe("catalog", () => {
  it("parses parts.json", () => {
    expect(parts.map((p) => p.id)).toEqual(["PART-001", "PART-002", "PART-003"]);
  });
});

describe("orientations", () => {
  it("cover all six axis permutations", () => {
    const size: Vec3 = [1, 2, 3];
    const keys = new Set(ORIENTATIONS.map((o) => rotatedSize(size, o).join(",")));
    expect(keys.size).toBe(6);
  });

  it("upright orientations keep Z vertical", () => {
    for (const o of ORIENTATIONS.filter((o) => o.upright)) {
      expect(rotatedSize([1, 2, 3], o)[2]).toBe(3);
    }
  });
});

describe("computeDesign", () => {
  it.each(parts.flatMap((p) => p.suggested_quantities.map((q) => [p.id, q] as const)))(
    "%s × %i produces a crate holding every part",
    (partId, quantity) => {
      const { design } = computeDesign({ ...DEFAULT_SETTINGS, partId, quantity });
      expect(design).not.toBeNull();
      const { layout } = design!;
      expect(layout.slots).toHaveLength(quantity);
      // Every slot fits inside the interior.
      for (const s of layout.slots) {
        for (let axis = 0; axis < 3; axis++) {
          expect(s.min[axis]).toBeGreaterThanOrEqual(0);
          expect(s.min[axis] + layout.cellSize[axis]).toBeLessThanOrEqual(layout.interior[axis] + 1e-6);
        }
      }
      expect(design!.grossKg).toBeGreaterThan(design!.payloadKg);
    },
  );

  it("never overlaps two parts", () => {
    const { design } = computeDesign({ ...DEFAULT_SETTINGS, partId: "PART-003", quantity: 8 });
    const { slots, cellSize } = design!.layout;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const overlaps = [0, 1, 2].every(
          (a) => slots[i].min[a] < slots[j].min[a] + cellSize[a] && slots[j].min[a] < slots[i].min[a] + cellSize[a],
        );
        expect(overlaps).toBe(false);
      }
    }
  });

  it("lays the long shaft flat with X as the crate length", () => {
    const { design } = computeDesign({ ...DEFAULT_SETTINGS, partId: "PART-002", quantity: 4, keepUpright: false });
    const [L, W] = design!.layout.external;
    expect(design!.layout.cellSize[0]).toBe(1530);
    expect(L).toBeGreaterThanOrEqual(W);
    expect(design!.layout.stable).toBe(true);
  });

  it("keeps the crate exterior equal to the bounds of its boards", () => {
    const { design } = computeDesign({ ...DEFAULT_SETTINGS, quantity: 8 });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const m of design!.members) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], m.min[a]);
        max[a] = Math.max(max[a], m.min[a] + m.size[a]);
      }
    }
    const extent = max.map((v, a) => v - min[a]);
    extent.forEach((e, a) => expect(e).toBeCloseTo(design!.layout.external[a], 3));
  });

  it("respects the layer limit", () => {
    const { layouts } = computeDesign({ ...DEFAULT_SETTINGS, quantity: 8, maxLayers: 1 });
    expect(layouts.every((l) => l.counts[2] === 1)).toBe(true);
  });
});
