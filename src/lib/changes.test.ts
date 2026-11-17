import { describe, expect, it } from "vitest";
import type { DesignChange } from "@/domain/diff";
import { changeSummary, NO_CHANGE } from "./changes";

const gross = (from: number, to: number): DesignChange => ({ field: "gross", from, to });
const outside = (from: number[], to: number[]): DesignChange => ({ field: "outside", from, to });
const panel = (from: number, to: number): DesignChange => ({ field: "panel", from, to });
const floor = (from: number, to: number): DesignChange => ({ field: "floor", from, to });

describe("changeSummary", () => {
  it("says nothing moved when nothing visible did", () => {
    expect(changeSummary([], "metric")).toBe(NO_CHANGE);
    expect(changeSummary([{ field: "payload", from: 10.1, to: 10.2 }], "metric")).toBe(NO_CHANGE);
  });

  it("summarises a size change as the outcome, with the new gross", () => {
    const big: DesignChange[] = [gross(135, 878), outside([932, 652, 497], [2176, 936, 831]), panel(12, 15), floor(19, 25), { field: "skidCount", from: 3, to: 4 }];
    expect(changeSummary(big, "metric")).toBe("Crate grew: 2176 × 936 × 831 mm, 878 kg");
    expect(changeSummary([outside([2176, 936, 831], [932, 652, 497]), gross(878, 135)], "metric")).toBe("Crate shrank: 932 × 652 × 497 mm, 135 kg");
  });

  it("uses the selected units", () => {
    expect(changeSummary([gross(100, 400), outside([500, 500, 500], [1000, 600, 700])], "imperial")).toBe("Crate grew: 39.4 × 23.6 × 27.6 in, 882 lb");
  });

  it("omits the weight when the gross did not move, and judges mixed moves by volume", () => {
    expect(changeSummary([outside([500, 500, 500], [600, 500, 500])], "metric")).toBe("Crate grew: 600 × 500 × 500 mm");
    expect(changeSummary([outside([500, 500, 500], [900, 500, 300])], "metric")).toBe("Crate grew: 900 × 500 × 300 mm");
    expect(changeSummary([outside([500, 500, 500], [600, 500, 300])], "metric")).toBe("Crate shrank: 600 × 500 × 300 mm");
  });

  it("keeps a lone small change as its own short detail", () => {
    expect(changeSummary([gross(16, 20)], "metric")).toBe("Gross 16 → 20 kg");
    expect(changeSummary([panel(12, 15)], "imperial")).toBe("Wall plywood 1/2″ → 5/8″");
  });

  it("says heavier or lighter when only the weights moved", () => {
    expect(changeSummary([gross(16, 20), { field: "payload", from: 10, to: 15 }], "metric")).toBe("Crate heavier: 20 kg");
    expect(changeSummary([gross(20, 16), { field: "payload", from: 15, to: 10 }], "metric")).toBe("Crate lighter: 16 kg");
  });

  it("names what changed when the construction did", () => {
    expect(changeSummary([panel(12, 15), floor(19, 25)], "metric")).toBe("Crate changed: wall plywood, floor");
    expect(changeSummary([panel(12, 15), floor(19, 25), { field: "skidCount", from: 3, to: 4 }], "metric")).toBe("Crate changed: wall plywood, floor, +1 more");
  });
});

describe("weights in change notes", () => {
  it("shows a move in whole units, and the new gross by the app's mass rule", () => {
    // 47.4 to 52.3 kg: the detail is the size of the move, the summary quotes the gross.
    expect(changeSummary([gross(47.4, 52.3)], "metric")).toBe("Gross 47 → 52 kg");
    expect(changeSummary([gross(47.4, 52.3), outside([500, 500, 500], [600, 500, 500])], "metric")).toBe("Crate grew: 600 × 500 × 500 mm, 52.3 kg");
    expect(changeSummary([gross(47.4, 52.3), { field: "payload", from: 10, to: 15 }], "imperial")).toBe("Crate heavier: 115 lb");
    expect(changeSummary([gross(47.4, 52.3)], "imperial")).toBe("Gross 104 → 115 lb");
  });
});
