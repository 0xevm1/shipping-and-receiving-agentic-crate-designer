import { describe, expect, it } from "vitest";
import { cutListFileName, designFileName } from "./fileNames";

describe("download file names", () => {
  const base = { partId: "PART-001", quantity: 4, crateLabel: "B" };

  it("names a single crate's cut list by part and quantity", () => {
    expect(cutListFileName({ ...base, split: false, whole: false })).toBe("crate-PART-001-x4.csv");
  });

  it("names a split batch's cut list by crate type or as the shipment", () => {
    expect(cutListFileName({ ...base, split: true, whole: false })).toBe("crate-PART-001-x4-crate-B.csv");
    expect(cutListFileName({ ...base, split: true, whole: true })).toBe("crate-PART-001-x4-shipment.csv");
  });

  it("names the design file", () => {
    expect(designFileName("PART-001", 4)).toBe("crate-design-PART-001-x4.json");
  });
});
