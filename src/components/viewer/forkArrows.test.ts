import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/domain/schema";
import {
  arrowFreeRect,
  arrowGapMm,
  arrowLengthMm,
  arrowOutline,
  arrowReachMm,
  arrowSamples,
  ARROW_LABEL_MARGIN_PX,
  ARROW_MARGIN_PX,
  ARROW_MIN_GAP_MM,
  ARROW_RETURN_SCALE,
  clearGapMm,
  fitArrowScale,
  HIDE_ABOVE,
  MIN_ARROW_SCALE,
  nextHidden,
  occludedShare,
  SHOW_BELOW,
  type Box,
} from "./forkArrows";

const box: Box = { min: [0, 0, 0], max: [1000, 500, 400] };

describe("fork arrow size", () => {
  it("length is 17 % of the crate length, kept between 180 and 320 mm", () => {
    expect(arrowLengthMm([500, 1, 1])).toBe(180);
    expect(arrowLengthMm([1500, 1, 1])).toBeCloseTo(255);
    expect(arrowLengthMm([5000, 1, 1])).toBe(320);
  });

  it("the tip stops beyond the width label: label offset, about a third of the longest side, and a margin", () => {
    const ext = [1000, 500, 400];
    expect(arrowGapMm(ext)).toBeCloseTo(110 + 50 + 360 + 90);
    expect(arrowReachMm(ext)).toBeCloseTo(arrowGapMm(ext) + arrowLengthMm(ext));
  });
});

describe("occludedShare", () => {
  // A flat arrow on the ground 100 mm beyond the +X end, seen from a raised eye.
  const arrow = arrowSamples([1100, 250, 2], 1, 200, 100);

  it("sees it all from the end it points out of", () => {
    expect(occludedShare([3000, 250, 900], arrow, box)).toBe(0);
  });

  it("hides it from the opposite side: the crate is in the way", () => {
    expect(occludedShare([-2000, 250, 900], arrow, box)).toBe(1);
  });

  it("a high eye looks over the near end of a low box", () => {
    const low: Box = { min: [0, 0, 0], max: [1000, 500, 50] };
    expect(occludedShare([-200, 250, 8000], arrow, low)).toBe(0);
  });

  it("spreads its samples over the arrow's length and width", () => {
    expect(arrow).toHaveLength(9);
    const xs = arrow.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(1100);
    expect(Math.max(...xs)).toBeLessThan(1300);
    expect(new Set(arrow.map((p: Vec3) => p[1])).size).toBe(3);
  });
});

describe("keeping an arrow in the free area", () => {
  // A flat "screen": 0.1 px per mm, the origin at (500, 300). The arrow points out of a crate end at x = 0.
  const project = (p: Vec3) => [500 + p[0] * 0.1, 300 + p[1] * 0.1] as const;
  const free = { left: 0, top: 0, right: 1000, bottom: 600 };
  const length = 300;
  const width = 200;

  it("keeps the tip where it is and the proportions when it scales", () => {
    const full = arrowOutline([100, 0, 2], 1, length, width);
    const half = arrowOutline([100, 0, 2], 1, length, width, 0.5);
    expect(full[0]).toEqual([100, 0, 2]);
    expect(half[0]).toEqual([100, 0, 2]);
    // Tail corner: half as far out, half as wide.
    expect(half[3][0] - 100).toBeCloseTo((full[3][0] - 100) / 2);
    expect(Math.abs(half[1][1] - half[2][1])).toBeCloseTo(Math.abs(full[1][1] - full[2][1]) / 2);
    // The −X end points its tail the other way.
    expect(arrowOutline([-100, 0, 2], -1, length, width)[3][0]).toBeLessThan(-100);
  });

  it("leaves an arrow that is inside alone", () => {
    expect(fitArrowScale([100, 0, 2], 1, length, width, project, free)).toBe(1);
  });

  it("shortens one whose tail would run out of the free area, to the longest that fits", () => {
    // The tail at 4800 mm (= 980 px) would leave less than the margin; the tip at 4000 is fine.
    const s = fitArrowScale([4000, 0, 2], 1, 1500, width, project, free);
    expect(s).toBeGreaterThanOrEqual(MIN_ARROW_SCALE);
    expect(s).toBeLessThan(1);
    for (const p of arrowOutline([4000, 0, 2], 1, 1500, width, s)) {
      const [x, y] = project(p);
      expect(x).toBeLessThanOrEqual(free.right - ARROW_MARGIN_PX + 1e-6);
      expect(y).toBeGreaterThanOrEqual(free.top + ARROW_MARGIN_PX);
    }
    // And no longer: a hair more would not fit.
    expect(arrowOutline([4000, 0, 2], 1, 1500, width, s + 0.02).some((p) => project(p)[0] > free.right - ARROW_MARGIN_PX)).toBe(true);
  });

  it("drops one whose tip is already outside, rather than drawing it under the island", () => {
    expect(fitArrowScale([5200, 0, 2], 1, length, width, project, free)).toBe(0);
    // Or off the left edge of the screen.
    expect(fitArrowScale([-5200, 0, 2], -1, length, width, project, free)).toBe(0);
  });

  it("needs more room to come back than to stay (hysteresis)", () => {
    // Fits at 0.55 of its size but not at 0.6: kept while shown, still dropped while dropped.
    const tip: Vec3 = [4000, 0, 2];
    const len = 1500;
    const shown = fitArrowScale(tip, 1, len, width, project, free, false);
    expect(shown).toBeGreaterThanOrEqual(MIN_ARROW_SCALE);
    const tight = { ...free, right: 500 + (tip[0] + len * 0.55) * 0.1 + ARROW_MARGIN_PX };
    expect(fitArrowScale(tip, 1, len, width, project, tight, false)).toBeGreaterThanOrEqual(MIN_ARROW_SCALE);
    expect(fitArrowScale(tip, 1, len, width, project, tight, true)).toBe(0);
    expect(ARROW_RETURN_SCALE).toBeGreaterThan(MIN_ARROW_SCALE);
  });

  it("lets an arrow run out toward the window's left edge, but never under the island or the bottom bars", () => {
    expect(arrowFreeRect({ left: 40, top: 96, right: 496, bottom: 130 }, 1440, 900)).toEqual({ left: 12, top: 96, right: 944, bottom: 770 });
    expect(arrowFreeRect({ left: 0, top: 0, right: 0, bottom: 130 }, 1440, 900).left).toBe(0);
  });
});

describe("the gap from the end face to the tip (clearGapMm)", () => {
  // The same flat screen. The width label sits 200 mm beyond the crate end (its pill is 88 × 28 px, 50 px each way with the margin).
  const near = { at: [200, 0, 0] as Vec3, halfPx: { x: 44, y: 14 } };
  const project = (p: Vec3) => [500 + p[0] * 0.1, 300 + p[1] * 0.1] as const;
  const label = { at: [2000, 0, 0] as Vec3, halfPx: { x: 44, y: 14 } };
  const outlineAt = (gap: number) => arrowOutline([gap, 0, 2], 1, 300, 200);

  it("stands as near as the minimum when nothing is in the way", () => {
    // A label far off to the side.
    expect(clearGapMm(outlineAt, project, { ...label, at: [2000, 3000, 0] }, 1000)).toBe(ARROW_MIN_GAP_MM);
  });

  it("stands just clear of the label's pill on screen, no further out than the worst case", () => {
    const gap = clearGapMm(outlineAt, project, near, 3000);
    expect(gap).toBeGreaterThan(ARROW_MIN_GAP_MM);
    expect(gap).toBeLessThan(3000);
    const box = (g: number) => {
      const px = outlineAt(g).map(project);
      return { left: Math.min(...px.map((p) => p[0])), right: Math.max(...px.map((p) => p[0])) };
    };
    // At the gap it found the arrow's near edge clears the pill (with the margin); a little nearer it would touch.
    const [lx] = project(near.at);
    expect(box(gap + 1).left).toBeGreaterThanOrEqual(lx + near.halfPx.x + ARROW_LABEL_MARGIN_PX - 1);
    expect(box(gap - 60).left).toBeLessThan(lx + near.halfPx.x + ARROW_LABEL_MARGIN_PX);
  });

  it("keeps the worst-case gap when even that overlaps the label", () => {
    expect(clearGapMm(outlineAt, project, { ...near, at: [300, 0, 0] }, 600)).toBe(600);
  });
});

describe("nextHidden (hysteresis)", () => {
  it("drops above the upper threshold, comes back below the lower one, and holds in between", () => {
    expect(nextHidden(false, HIDE_ABOVE + 0.01)).toBe(true);
    expect(nextHidden(false, (HIDE_ABOVE + SHOW_BELOW) / 2)).toBe(false);
    expect(nextHidden(true, (HIDE_ABOVE + SHOW_BELOW) / 2)).toBe(true);
    expect(nextHidden(true, SHOW_BELOW - 0.01)).toBe(false);
  });
});
