import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/domain/schema";
import { arrowGapMm, arrowLengthMm, arrowReachMm, arrowSamples, HIDE_ABOVE, nextHidden, occludedShare, SHOW_BELOW, type Box } from "./forkArrows";

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

describe("nextHidden (hysteresis)", () => {
  it("drops above the upper threshold, comes back below the lower one, and holds in between", () => {
    expect(nextHidden(false, HIDE_ABOVE + 0.01)).toBe(true);
    expect(nextHidden(false, (HIDE_ABOVE + SHOW_BELOW) / 2)).toBe(false);
    expect(nextHidden(true, (HIDE_ABOVE + SHOW_BELOW) / 2)).toBe(true);
    expect(nextHidden(true, SHOW_BELOW - 0.01)).toBe(false);
  });
});
