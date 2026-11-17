import { describe, expect, it } from "vitest";
import { memberBounds } from "./memberBounds";

describe("memberBounds", () => {
  it("is the box around the members, and its centre", () => {
    const b = memberBounds([
      { min: [-10, 0, 5], size: [20, 10, 5] },
      { min: [30, -4, 0], size: [10, 4, 20] },
    ]);
    expect(b.min).toEqual([-10, -4, 0]);
    expect(b.max).toEqual([40, 10, 20]);
    expect(b.centre).toEqual([15, 3, 10]);
  });
});
