import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import type { ForkEntry } from "@/domain/forkEntry";
import type { Vec3 } from "@/domain/schema";
import { custom, designOf } from "@/domain/testFixtures";
import {
  arrowFreeRect,
  arrowGapMm,
  arrowLengthMm,
  arrowOutline,
  arrowReachMm,
  arrowSamples,
  crateRange,
  fitArrowScale,
  forkEnds,
  layoutArrows,
  occludedShare,
  type Box,
} from "./forkArrows";
import { keepInView } from "./framing";

/** The fork arrows follow the fork-entry standard (#112): their directions are pure functions of the design. */
const box: Box = { min: [0, 0, 0], max: [1000, 500, 400] };

describe("arrows on the sides", () => {
  it("point along Y: the tip stays, the tail runs out of the side, the head is across X", () => {
    const low = arrowOutline([300, -100, 2], -1, 200, 100, 1, 1);
    expect(low[0]).toEqual([300, -100, 2]);
    // The -Y side's tail is further toward -Y; the head corners are 100 mm apart across X.
    expect(low[3][1]).toBeLessThan(-100);
    expect(Math.abs(low[1][0] - low[2][0])).toBeCloseTo(100);
    const high = arrowOutline([300, 900, 2], 1, 200, 100, 1, 1);
    expect(high[3][1]).toBeGreaterThan(900);
    // Along X is what it was before the axis existed.
    expect(arrowOutline([300, 0, 2], 1, 200, 100)).toEqual(arrowOutline([300, 0, 2], 1, 200, 100, 1, 0));
  });

  it("samples the arrow over its length (Y) and width (X)", () => {
    const pts = arrowSamples([300, 900, 2], 1, 200, 100, 1);
    expect(pts).toHaveLength(9);
    expect(Math.min(...pts.map((p) => p[1]))).toBeGreaterThan(900);
    expect(Math.max(...pts.map((p) => p[1]))).toBeLessThan(1100);
    expect(new Set(pts.map((p) => p[0])).size).toBe(3);
  });

  it("is hidden by the crate when the eye is on the far side", () => {
    const arrow = arrowSamples([500, 600, 2], 1, 200, 100, 1);
    expect(occludedShare([500, 3000, 900], arrow, box)).toBe(0);
    expect(occludedShare([500, -2000, 900], arrow, box)).toBe(1);
  });

  it("is as long as the side it points along, between the same limits", () => {
    expect(arrowLengthMm([5000, 500, 1], 1)).toBe(180);
    expect(arrowLengthMm([500, 1500, 1], 1)).toBeCloseTo(255);
    expect(arrowReachMm([1000, 500, 400], 1)).toBeCloseTo(arrowGapMm([1000, 500, 400]) + 180);
  });

  it("fits in the free area the same way along Y", () => {
    const project = (p: Vec3) => [500 + p[0] * 0.1, 300 + p[1] * 0.1] as const;
    const free = { left: 0, top: 0, right: 1000, bottom: 600 };
    expect(fitArrowScale([0, 100, 2], 1, 300, 200, project, free, false, 1)).toBe(1);
    expect(fitArrowScale([0, 2400, 2], 1, 1500, 200, project, free, false, 1)).toBeLessThan(1);
    expect(fitArrowScale([0, 3200, 2], 1, 300, 200, project, free, false, 1)).toBe(0);
  });
});

describe("the faces the forks enter, per fork entry", () => {
  const built = (forkEntry: ForkEntry) => designOf(getPart("PART-003"), { quantity: 8 }, custom({ handling: { forkEntry } }));
  const project = (p: Vec3) => [800 + p[0] * 0.2, 500 - p[1] * 0.2 - p[2] * 0.1] as const;
  const free = arrowFreeRect({ left: 0, top: 0, right: 0, bottom: 0 }, 1600, 1000);
  const label = { at: [0, 0, 0] as Vec3, halfPx: { x: 44, y: 14 } };

  it("ends: the -X and +X faces, an arrow per opening between the skids", () => {
    const d = built("ends");
    expect(forkEnds(d).map((e) => [e.axis, e.outward])).toEqual([
      [0, -1],
      [0, 1],
    ]);
    const placed = layoutArrows(d, 0, project, free, label);
    expect(placed).toHaveLength(2 * d.handling.entries[0].openings.length);
    expect(placed.every((a) => a.axis === 0)).toBe(true);
    // The tip stands outside the end face it points out of.
    const [x0, x1] = crateRange(d, 0);
    for (const a of placed) expect(a.outward < 0 ? a.tip[0] < x0 : a.tip[0] > x1).toBe(true);
  });

  it("sides: the -Y and +Y faces, pointing along Y into the openings measured along X", () => {
    const d = built("sides");
    expect(forkEnds(d).map((e) => [e.axis, e.outward])).toEqual([
      [1, -1],
      [1, 1],
    ]);
    const placed = layoutArrows(d, 0, project, free, label);
    const [y0, y1] = crateRange(d, 1);
    expect(placed).toHaveLength(2 * d.handling.entries[0].openings.length);
    for (const a of placed) {
      expect(a.axis).toBe(1);
      expect(a.outward < 0 ? a.tip[1] < y0 : a.tip[1] > y1).toBe(true);
    }
    // Across the arrow (X) it is centred on an opening between two side skids.
    const centres = d.handling.entries[0].openings.map((o) => o.y + o.width / 2);
    for (const a of placed) expect(centres.some((c) => Math.abs(c - a.tip[0]) < 1e-6)).toBe(true);
    // No size label stands in front of a side, so every arrow keeps the full worst-case gap.
    expect(new Set(placed.map((a) => a.gap))).toEqual(new Set([arrowGapMm(d.layout.external)]));
  });

  it("four-way: all four faces, the end arrows in the skid gaps and the side arrows in the gap between the blocks", () => {
    const d = built("fourWay");
    expect(forkEnds(d).map((e) => [e.axis, e.outward])).toEqual([
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 1],
    ]);
    const placed = layoutArrows(d, 0, project, free, label);
    const [ends, sides] = d.handling.entries;
    expect(placed.filter((a) => a.axis === 0)).toHaveLength(2 * ends.openings.length);
    expect(placed.filter((a) => a.axis === 1)).toHaveLength(2 * sides.openings.length);
    expect(new Set(placed.map((a) => a.end))).toEqual(new Set([0, 1, 2, 3]));
  });

  it("slides out with the walls when exploded", () => {
    const d = built("sides");
    const at = (out: number) => layoutArrows(d, out, project, free, label).map((a) => a.tip[1] * a.outward);
    const [closed, open] = [at(0), at(300)];
    closed.forEach((y, i) => expect(open[i] - y).toBeCloseTo(300));
  });

  it("keeps each face's tails in view once exploded", () => {
    const sides = built("sides");
    const tails = keepInView(sides, 1).slice(3);
    expect(tails).toHaveLength(2 * sides.handling.entries[0].openings.length);
    // The side arrows' tails stand out past the -Y and +Y faces.
    const [y0, y1] = crateRange(sides, 1);
    expect(tails.some((t) => t.at[1] < y0)).toBe(true);
    expect(tails.some((t) => t.at[1] > y1)).toBe(true);
    const four = built("fourWay");
    expect(keepInView(four, 1)).toHaveLength(3 + 2 * four.handling.entries.reduce((n, e) => n + e.openings.length, 0));
  });
});
