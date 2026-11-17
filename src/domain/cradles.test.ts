import { describe, expect, it } from "vitest";
import { metricText as metric } from "@/lib/message";
import { getPart, parts } from "./catalog";
import { cradleProfile, cradleSolidAt, cradleStations, isSlender, notchFor, usesCradles, CRADLE_LABEL, END_STOP_LABEL, STACKING_CRADLE_LABEL } from "./cradles";
import { screwSchedule, type Member } from "./crate";
import { computeDesign, DEFAULT_SETTINGS, type DesignPart } from "./design";
import type { CrateSettings, Vec3 } from "./schema";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards, type DeepPartial, type ShopStandards } from "./standards";

const S = DEFAULT_STANDARDS;
const custom = (patch: DeepPartial<ShopStandards>): ShopStandards => {
  const r = parseStandards(mergeStandards(S, patch));
  if (!r.ok) throw new Error(r.error);
  return r.standards;
};
const design = (partId: string, patch: Partial<CrateSettings> = {}, standards = S) =>
  computeDesign(getPart(partId), { ...DEFAULT_SETTINGS, ...patch }, null, standards).design!;
const shaft = (patch: Partial<CrateSettings> = {}) => design("PART-002", patch);
const ofLabel = (members: Member[], label: string) => members.filter((m) => m.label === label);
const centre = (m: Member, axis: number) => m.min[axis] + m.size[axis] / 2;

describe("isSlender", () => {
  it("picks the shaft and not the bracket or the housing", () => {
    expect(isSlender(getPart("PART-002").dimensions_mm, S)).toBe(true);
    expect(isSlender(getPart("PART-001").dimensions_mm, S)).toBe(false);
    expect(isSlender(getPart("PART-003").dimensions_mm, S)).toBe(false);
  });

  it("is longest ÷ middle ≥ the standard, in any order of sides", () => {
    expect(isSlender([300, 100, 20], S)).toBe(true); // exactly 3
    expect(isSlender([100, 300, 20], S)).toBe(true);
    expect(isSlender([299, 100, 20], S)).toBe(false);
    expect(isSlender([300, 100, 20], custom({ cradle: { slenderRatio: 3.5 } }))).toBe(false);
  });

  it("ignores a flat plate: thin, but not long against its width", () => {
    expect(isSlender([600, 500, 10], S)).toBe(false);
  });

  it("only cradles a slender part lying flat", () => {
    const dims = getPart("PART-002").dimensions_mm;
    expect(usesCradles(dims, { cellSize: [1530, 172, 172] }, S)).toBe(true);
    expect(usesCradles(dims, { cellSize: [172, 1530, 172] }, S)).toBe(true);
    expect(usesCradles(dims, { cellSize: [172, 172, 1530] }, S)).toBe(false);
  });
});

describe("cradle standards", () => {
  it("ship with the documented defaults", () => {
    expect(S.cradle).toEqual({ slenderRatio: 3, maxSpacingMm: 600, endOffsetMm: 150, notchDepth: 0.25, roundTolerance: 0.1, thickMm: 38 });
  });

  it("are validated", () => {
    const bad = (cradle: DeepPartial<ShopStandards["cradle"]>) => parseStandards(mergeStandards(S, { cradle }));
    expect(bad({ slenderRatio: 1 }).ok).toBe(false);
    expect(bad({ maxSpacingMm: 50 }).ok).toBe(false);
    expect(bad({ notchDepth: 0.5 }).ok).toBe(false);
    expect(bad({ thickMm: 0 }).ok).toBe(false);
    const r = bad({ endOffsetMm: 700 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^cradle\.endOffsetMm/);
  });
});

describe("cradleStations", () => {
  it("puts one 150 mm in from each end and the rest at most 600 apart", () => {
    const at = cradleStations(50, 1530, S);
    expect(at[0]).toBeCloseTo(200);
    expect(at[at.length - 1]).toBeCloseTo(50 + 1530 - 150);
    expect(at).toHaveLength(4); // 1230 mm between the end cradles → 3 gaps of 410
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeLessThanOrEqual(600 + 1e-9);
  });

  it("keeps at least two on a short part, without them meeting", () => {
    const at = cradleStations(0, 300, S);
    expect(at).toEqual([75, 225]);
  });

  it("adds a cradle exactly when the spacing would go over the limit", () => {
    expect(cradleStations(0, 900, S)).toHaveLength(2); // 600 apart
    expect(cradleStations(0, 901, S)).toHaveLength(3);
  });

  it("follows the spacing standard", () => {
    expect(cradleStations(0, 1530, custom({ cradle: { maxSpacingMm: 300, endOffsetMm: 100 } }))).toHaveLength(6);
  });
});

describe("notchFor", () => {
  it("gives a round part a seat of its radius, a quarter of its height deep", () => {
    const n = notchFor(172, 172, S);
    expect(n.shape).toBe("round");
    expect(n.depth).toBeCloseTo(43);
    expect(n.radius).toBeCloseTo(86);
    expect(n.width).toBeCloseTo(2 * Math.sqrt(43 * 129)); // the chord at that depth
  });

  it("gives any other section a flat pocket as wide as the part", () => {
    expect(notchFor(200, 100, S)).toEqual({ shape: "flat", width: 200, depth: 25, radius: 0 });
  });

  it("follows the depth standard", () => {
    expect(notchFor(172, 172, custom({ cradle: { notchDepth: 0.4 } })).depth).toBeCloseTo(68.8);
  });
});

describe("cradles in the shaft crate", () => {
  it("replaces bearers, separators and side blocking with cradles and end stops", () => {
    for (const quantity of [1, 2, 4]) {
      const d = shaft({ quantity });
      const kinds = new Set(d.members.filter((m) => m.assembly === "inside").map((m) => m.kind));
      expect(kinds).toEqual(new Set(["cradle", "blocking"]));
      for (const post of d.members.filter((m) => m.kind === "blocking")) expect(post.label).toBe(END_STOP_LABEL);
    }
  });

  it("puts 4 cradles under a single shaft, wall to wall, across its length", () => {
    const d = shaft({ quantity: 1 });
    const [, W] = d.layout.interior;
    const slot = d.layout.slots[0];
    const cradles = ofLabel(d.members, CRADLE_LABEL);
    expect(cradles).toHaveLength(4);
    const xs = cradles.map((m) => centre(m, 0)).sort((a, b) => a - b);
    expect(xs[0] - slot.min[0]).toBeCloseTo(150);
    expect(slot.min[0] + 1530 - xs[3]).toBeCloseTo(150);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(600);
    for (const m of cradles) {
      expect(m.size[0]).toBe(38);
      expect(m.min[1]).toBe(0);
      expect(m.size[1]).toBe(W);
      expect(m.min[2]).toBe(0);
      // The part's bottom sits at the notch bottom: top = part bottom + notch depth.
      expect(m.min[2] + m.size[2]).toBeCloseTo(slot.min[2] + 43);
      expect(m.cradle?.axis).toBe(1);
      expect(m.cradle?.notches).toHaveLength(1);
      expect(m.cradle?.notches[0]).toMatchObject({ face: "top", shape: "round", center: slot.min[1] + 86 });
    }
  });

  it("holds the shaft at both ends with end stops", () => {
    const d = shaft({ quantity: 1 });
    const stops = ofLabel(d.members, END_STOP_LABEL);
    expect(stops).toHaveLength(2);
    const slot = d.layout.slots[0];
    const [L] = d.layout.interior;
    const xs = stops.map((m) => [m.min[0], m.min[0] + m.size[0]]).sort((a, b) => a[0] - b[0]);
    expect(xs[0]).toEqual([0, slot.min[0]]);
    expect(xs[1]).toEqual([slot.min[0] + 1530, L]);
  });

  it("puts one notch per part when shafts lie side by side", () => {
    const d = shaft({ quantity: 2 });
    expect(d.layout.counts).toEqual([1, 2, 1]);
    const cradles = ofLabel(d.members, CRADLE_LABEL);
    expect(cradles).toHaveLength(4);
    for (const m of cradles) {
      const centres = m.cradle!.notches.map((n) => n.center);
      expect(centres).toEqual(d.layout.slots.map((s) => s.min[1] + 86).sort((a, b) => a - b));
    }
  });

  it("stacks the layers' cradles: stacking cradles over the bottom ones, notched both ways, and no separator", () => {
    const d = shaft({ quantity: 4 });
    expect(d.layout.counts[2]).toBe(2);
    expect(d.members.some((m) => m.kind === "separator")).toBe(false);
    const bottom = ofLabel(d.members, CRADLE_LABEL);
    const stacking = ofLabel(d.members, STACKING_CRADLE_LABEL);
    expect(bottom).toHaveLength(4);
    expect(stacking).toHaveLength(4);
    const c = d.layout.cellSize[2];
    const z0 = d.layout.slots.find((s) => s.index[2] === 0)!.min[2];
    const z1 = d.layout.slots.find((s) => s.index[2] === 1)!.min[2];
    for (const m of stacking) {
      // Same stations as the bottom cradles.
      expect(bottom.some((b) => b.min[0] === m.min[0])).toBe(true);
      expect(m.min[2]).toBeCloseTo(z0 + c - 43);
      expect(m.min[2] + m.size[2]).toBeCloseTo(z1 + 43);
      const faces = m.cradle!.notches.map((n) => n.face);
      expect(faces.filter((f) => f === "bottom")).toHaveLength(2);
      expect(faces.filter((f) => f === "top")).toHaveLength(2);
    }
    // Clear of the bottom cradles.
    expect(Math.min(...stacking.map((m) => m.min[2]))).toBeGreaterThan(Math.max(...bottom.map((m) => m.min[2] + m.size[2])));
  });

  it("runs end stops from the floor to the top of the stack", () => {
    const d = shaft({ quantity: 4 });
    const top = Math.max(...d.layout.slots.map((s) => s.min[2])) + d.layout.cellSize[2];
    const stops = ofLabel(d.members, END_STOP_LABEL);
    expect(stops).toHaveLength(4); // 2 columns × 2 ends
    for (const m of stops) {
      expect(m.min[2]).toBe(0);
      expect(m.size[2]).toBeCloseTo(top);
    }
  });

  it("keeps every cradle inside the crate and the exterior equal to the boards' bounds", () => {
    for (const quantity of [1, 2, 4]) {
      const d = shaft({ quantity });
      const [L, W, H] = d.layout.interior;
      for (const m of d.members.filter((x) => x.kind === "cradle")) {
        expect(m.min[0]).toBeGreaterThanOrEqual(0);
        expect(m.min[0] + m.size[0]).toBeLessThanOrEqual(L);
        expect(m.min[1] + m.size[1]).toBeLessThanOrEqual(W + 1e-9);
        expect(m.min[2] + m.size[2]).toBeLessThanOrEqual(H);
      }
    }
  });

  it("turns with the part when its length lies along Y", () => {
    const part: DesignPart = { id: "rod", name: "Rod", mass_kg: 2, dimensions_mm: [600, 40, 40] };
    const r = computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 20, maxLayers: 1 });
    const along = r.layouts.find((l) => l.cellSize[1] === 600)!;
    expect(along).toBeDefined();
    const d = computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 20, maxLayers: 1 }, along.key).design!;
    const cradles = ofLabel(d.members, CRADLE_LABEL);
    expect(cradles.length).toBeGreaterThanOrEqual(2);
    for (const m of cradles) {
      expect(m.cradle?.axis).toBe(0);
      expect(m.size[1]).toBe(38);
      expect(m.size[0]).toBe(d.layout.interior[0]);
    }
  });

  it("gives a flat bar a flat pocket", () => {
    const part: DesignPart = { id: "bar", name: "Flat bar", mass_kg: 5, dimensions_mm: [1200, 100, 40] };
    const d = computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 1 }).design!;
    const n = ofLabel(d.members, CRADLE_LABEL)[0].cradle!.notches[0];
    expect(n.shape).toBe("flat");
    expect(n.width).toBe(d.layout.cellSize[1]);
    expect(n.depth).toBeCloseTo(d.layout.cellSize[2] * 0.25);
  });

  it("leaves a shaft stood on end with the general blocking", () => {
    const r = computeDesign(getPart("PART-002"), { ...DEFAULT_SETTINGS, quantity: 1, keepUpright: false });
    const standing = r.layouts.find((l) => l.cellSize[2] === 1530)!;
    const d = computeDesign(getPart("PART-002"), { ...DEFAULT_SETTINGS, quantity: 1, keepUpright: false }, standing.key).design!;
    expect(d.members.some((m) => m.kind === "cradle")).toBe(false);
    expect(d.members.some((m) => m.label === "Blocking post")).toBe(true);
  });

  it("never cradles the bracket or the housing", () => {
    for (const p of parts.filter((x) => x.id !== "PART-002")) {
      for (const quantity of p.suggested_quantities) {
        expect(design(p.id, { quantity }).members.some((m) => m.kind === "cradle")).toBe(false);
      }
    }
  });
});

describe("cradles in the cut list, screws and labour", () => {
  it("are their own cut-list lines, linked to the members", () => {
    const d = shaft({ quantity: 4 });
    const lines = d.bom.filter((l) => l.kind === "cradle");
    expect(lines.map((l) => l.label).sort()).toEqual([CRADLE_LABEL, STACKING_CRADLE_LABEL]);
    for (const l of lines) {
      expect(l.material).toBe("lumber");
      expect(l.assembly).toBe("inside");
      expect(l.qty).toBe(4);
      expect(l.notches).toBe(l.label === CRADLE_LABEL ? 2 : 4);
      expect(d.members.filter((m) => m.bomKey === l.key)).toHaveLength(4);
    }
    // 38 thick, cut to the crate's inside width.
    const bottom = lines.find((l) => l.label === CRADLE_LABEL)!;
    expect(bottom.stockMm[0]).toBe(38);
    expect(bottom.cutMm).toEqual([Math.round(d.layout.interior[1])]);
  });

  it("get 4 screws each in the fastener schedule", () => {
    const d = shaft({ quantity: 4 });
    const s = screwSchedule(d.members, d.layout.interior, S);
    expect(s.find((l) => l.id === "cradles")?.qty).toBe(16);
    expect(s.find((l) => l.id === "stacking-cradles")?.qty).toBe(16);
    expect(s.find((l) => l.id === "blocking")).toMatchObject({ title: "End stops", qty: 8 });
    expect(s.find((l) => l.id === "bearers")).toBeUndefined();
    expect(d.screws).toBe(s.reduce((n, l) => n + l.qty, 0));
  });

  it("count each notch as a lumber cut", () => {
    const d = shaft({ quantity: 1 });
    const pieces = d.bom.filter((l) => l.material === "lumber").reduce((n, l) => n + l.qty, 0);
    expect(d.labour.counts.lumberCuts).toBe(pieces + 4); // 4 cradles, one notch each
  });

  it("say so in the blocking check", () => {
    const check = shaft({ quantity: 1 }).checks.find((c) => c.id === "blocking")!;
    expect(check.level).toBe("ok");
    expect(metric(check.detail)).toMatch(/4 notched cradles .* 2 end stops/);
  });
});

describe("cradleProfile and cradleSolidAt", () => {
  const d = shaft({ quantity: 4 });
  const bottom = ofLabel(d.members, CRADLE_LABEL)[0];
  const stacking = ofLabel(d.members, STACKING_CRADLE_LABEL)[0];

  it("outlines the board with its notches cut in", () => {
    const pts = cradleProfile(bottom);
    const top = bottom.min[2] + bottom.size[2];
    const lowest = Math.min(...pts.filter(([, z]) => z > bottom.min[2]).map(([, z]) => z));
    expect(lowest).toBeCloseTo(top - 43);
    for (const [a, z] of pts) {
      expect(a).toBeGreaterThanOrEqual(bottom.min[1] - 1e-9);
      expect(a).toBeLessThanOrEqual(bottom.min[1] + bottom.size[1] + 1e-9);
      expect(z).toBeGreaterThanOrEqual(bottom.min[2] - 1e-9);
      expect(z).toBeLessThanOrEqual(top + 1e-9);
    }
    // Counter-clockwise: positive signed area, smaller than the bounding rectangle.
    const area = pts.reduce((s, [x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      return s + (x1 * y2 - x2 * y1) / 2;
    }, 0);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(bottom.size[1] * bottom.size[2]);
  });

  it("is shorter through a notch than beside it", () => {
    const n = bottom.cradle!.notches[0];
    const top = bottom.min[2] + bottom.size[2];
    expect(cradleSolidAt(bottom, n.center)).toEqual([0, top - n.depth]);
    expect(cradleSolidAt(bottom, 1)).toEqual([0, top]);
    const m = stacking.cradle!.notches[0];
    const [lo, hi] = cradleSolidAt(stacking, m.center);
    expect(lo).toBeCloseTo(stacking.min[2] + 43);
    expect(hi).toBeCloseTo(stacking.min[2] + stacking.size[2] - 43);
  });

  it("is a rectangle for a board without notches", () => {
    const m = { min: [0, 0, 0] as Vec3, size: [10, 20, 30] as Vec3 };
    expect(cradleProfile(m)).toEqual([
      [0, 0],
      [20, 0],
      [20, 30],
      [0, 30],
    ]);
  });
});
