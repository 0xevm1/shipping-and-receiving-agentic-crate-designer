import { describe, expect, it } from "vitest";
import { getPart, parts } from "./catalog";
import { ASSEMBLIES } from "./crate";
import { computeDesign, DEFAULT_SETTINGS, explainLayout, type DesignPart } from "./design";
import { ORIENTATIONS, rotatedSize } from "./orientations";
import type { CrateSettings, Vec3 } from "./schema";

const design = (partId: string, patch: Partial<CrateSettings> = {}) =>
  computeDesign(getPart(partId), { ...DEFAULT_SETTINGS, ...patch });

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
      const { design: d } = design(partId, { quantity });
      expect(d).not.toBeNull();
      const { layout } = d!;
      expect(layout.slots).toHaveLength(quantity);
      // Every slot fits inside the interior.
      for (const s of layout.slots) {
        for (let axis = 0; axis < 3; axis++) {
          expect(s.min[axis]).toBeGreaterThanOrEqual(0);
          expect(s.min[axis] + layout.cellSize[axis]).toBeLessThanOrEqual(layout.interior[axis] + 1e-6);
        }
      }
      expect(d!.grossKg).toBeGreaterThan(d!.payloadKg);
    },
  );

  it("never overlaps two parts", () => {
    const { design: d } = design("PART-003", { quantity: 8 });
    const { slots, cellSize } = d!.layout;
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
    const { design: d } = design("PART-002", { quantity: 4, keepUpright: false });
    const [L, W] = d!.layout.external;
    expect(d!.layout.cellSize[0]).toBe(1530);
    expect(L).toBeGreaterThanOrEqual(W);
    expect(d!.layout.stable).toBe(true);
  });

  it("keeps the crate exterior equal to the bounds of its boards", () => {
    const { design: d } = design("PART-001", { quantity: 8 });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const m of d!.members) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], m.min[a]);
        max[a] = Math.max(max[a], m.min[a] + m.size[a]);
      }
    }
    const extent = max.map((v, a) => v - min[a]);
    extent.forEach((e, a) => expect(e).toBeCloseTo(d!.layout.external[a], 3));
  });

  it("respects the layer limit", () => {
    const { layouts } = design("PART-001", { quantity: 8, maxLayers: 1 });
    expect(layouts.every((l) => l.counts[2] === 1)).toBe(true);
  });

  it("accepts a part that is not in the catalog", () => {
    const custom: DesignPart = { id: "custom", name: "Loaded part", mass_kg: 10, dimensions_mm: [300, 200, 100] };
    const { design: d } = computeDesign(custom, { ...DEFAULT_SETTINGS, quantity: 2 });
    expect(d!.layout.slots).toHaveLength(2);
    expect(d!.payloadKg).toBe(20);
  });
});

/**
 * Captured from the pre-redesign domain (commit 842ee77) for every part ×
 * suggested quantity × keepUpright. The UI redesign must not change any of these.
 * Columns: part, qty, upright, external mm, gross kg, screws, members, layouts, BOM qty.
 */
const BASELINE: [string, number, boolean, Vec3, number, number, number, number, number][] = [
  ["PART-001", 1, true, [522, 382, 497], 42.29, 118, 34, 1, 34],
  ["PART-001", 1, false, [522, 420, 459], 42, 112, 34, 3, 34],
  ["PART-001", 4, true, [932, 652, 497], 134.95, 202, 53, 5, 53],
  ["PART-001", 4, false, [728, 652, 599], 132.68, 194, 53, 15, 53],
  ["PART-001", 8, true, [938, 658, 823], 248.51, 258, 66, 8, 66],
  ["PART-001", 8, false, [938, 734, 747], 247.07, 251, 66, 24, 66],
  ["PART-002", 1, true, [1692, 334, 411], 76.25, 200, 40, 1, 40],
  ["PART-002", 1, false, [1692, 334, 411], 76.25, 200, 40, 2, 40],
  ["PART-002", 2, true, [1692, 556, 411], 120.44, 226, 45, 3, 45],
  ["PART-002", 2, false, [1692, 556, 411], 120.44, 226, 45, 5, 45],
  ["PART-002", 4, true, [1692, 556, 645], 193.08, 268, 53, 5, 53],
  ["PART-002", 4, false, [1692, 556, 645], 193.08, 268, 53, 8, 53],
  ["PART-003", 1, true, [607, 597, 493], 39.43, 132, 34, 1, 34],
  ["PART-003", 1, false, [607, 597, 493], 39.43, 132, 34, 3, 34],
  ["PART-003", 4, true, [1082, 607, 809], 112.13, 238, 52, 5, 52],
  ["PART-003", 4, false, [1102, 720, 674], 115.38, 237, 53, 15, 53],
  ["PART-003", 8, true, [1102, 1082, 809], 195.09, 308, 67, 8, 67],
  ["PART-003", 8, false, [1102, 1082, 809], 195.09, 308, 67, 24, 67],
];

describe("regression baseline", () => {
  it.each(BASELINE)("%s × %i (upright %s) is unchanged", (partId, quantity, keepUpright, ext, gross, screws, members, layouts, bomQty) => {
    const r = design(partId, { quantity, keepUpright });
    const d = r.design!;
    expect(d.layout.external.map((v) => Math.round(v))).toEqual(ext);
    expect(d.grossKg).toBeCloseTo(gross, 2);
    expect(d.screws).toBe(screws);
    expect(d.members).toHaveLength(members);
    expect(r.layouts).toHaveLength(layouts);
    expect(d.bom.reduce((s, l) => s + l.qty, 0)).toBe(bomQty);
  });
});

describe("members and cut list", () => {
  const d = design("PART-003", { quantity: 8 }).design!;

  it("tags every member with an assembly, a face and a label", () => {
    for (const m of d.members) {
      expect(ASSEMBLIES).toContain(m.assembly);
      expect(m.label.length).toBeGreaterThan(0);
    }
    const faceOf = (label: string) => new Set(d.members.filter((m) => m.label === label).map((m) => m.face));
    expect(faceOf("Lid panel")).toEqual(new Set(["lid"]));
    expect(faceOf("Side panel")).toEqual(new Set(["side-", "side+"]));
    expect(faceOf("End panel")).toEqual(new Set(["end-", "end+"]));
    expect(faceOf("Skid")).toEqual(new Set(["base"]));
    expect(faceOf("Blocking post")).toEqual(new Set(["inside"]));
  });

  it("puts each face on the right side of the interior", () => {
    const [L, W] = d.layout.interior;
    for (const m of d.members) {
      if (m.face === "side-") expect(m.min[1] + m.size[1]).toBeLessThanOrEqual(0.5);
      if (m.face === "side+") expect(m.min[1]).toBeGreaterThanOrEqual(W - 0.5);
      if (m.face === "end-") expect(m.min[0] + m.size[0]).toBeLessThanOrEqual(0.5);
      if (m.face === "end+") expect(m.min[0]).toBeGreaterThanOrEqual(L - 0.5);
    }
  });

  it("distinguishes rails, uprights and lid cleats in the cut list", () => {
    const labels = new Set(d.bom.map((l) => l.label));
    for (const l of ["Side rail", "Side upright", "End rail", "End upright", "Lid edge cleat", "Lid cross cleat"]) {
      expect(labels).toContain(l);
    }
  });

  it("splits the crate weight by assembly", () => {
    const sum = Object.values(d.tareKgByAssembly).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(d.tareKg, 6);
  });

  it("links every member to exactly one cut-list line", () => {
    const keys = new Set(d.bom.map((l) => l.key));
    expect(keys.size).toBe(d.bom.length);
    for (const m of d.members) expect(keys).toContain(m.bomKey);
    for (const line of d.bom) {
      expect(d.members.filter((m) => m.bomKey === line.key)).toHaveLength(line.qty);
    }
  });
});

describe("checks", () => {
  const level = (r: ReturnType<typeof design>, id: string) => r.design!.checks.find((c) => c.id === id)?.level;

  it("reports passes as well as problems", () => {
    const r = design("PART-003", { quantity: 8 });
    expect(level(r, "door")).toBe("ok");
    expect(level(r, "stable")).toBe("ok");
    expect(level(r, "blocking")).toBe("ok");
    expect(level(r, "base-rating")).toBe("ok");
    expect(level(r, "export")).toBe("info");
  });

  it("flags tight gaps and tall crates", () => {
    expect(level(design("PART-001", { partGapMm: 10 }), "blocking")).toBe("caution");
    const tall = design("PART-002", { quantity: 1, keepUpright: false });
    const standing = tall.layouts.find((l) => !l.stable)!;
    const r = computeDesign(getPart("PART-002"), { ...DEFAULT_SETTINGS, quantity: 1, keepUpright: false }, standing.key);
    expect(level(r, "stable")).toBe("caution");
  });

  it("only reports a stack check when parts are stacked", () => {
    expect(level(design("PART-001", { quantity: 4 }), "stack")).toBeUndefined();
    expect(level(design("PART-001", { quantity: 8 }), "stack")).toBe("ok");
  });
});

describe("explainLayout", () => {
  it("says when there is only one way to pack", () => {
    const r = design("PART-001", { quantity: 1 });
    expect(explainLayout(r.layouts, r.design!.layout)).toEqual({ kind: "only" });
  });

  it("compares the recommended layout with the runner-up", () => {
    const r = design("PART-003", { quantity: 8 });
    const e = explainLayout(r.layouts, r.design!.layout);
    expect(["smaller", "tie", "stable"]).toContain(e.kind);
  });

  it("measures a user pick against the recommendation", () => {
    const base = design("PART-003", { quantity: 8 });
    const pick = base.layouts[base.layouts.length - 1];
    const e = explainLayout(base.layouts, pick);
    expect(e.kind).toBe("picked");
    if (e.kind === "picked") expect(e.morePct).toBeGreaterThan(0);
  });
});
