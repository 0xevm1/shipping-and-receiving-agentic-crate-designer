import { describe, expect, it } from "vitest";
import { clampNote } from "./clampNote";

describe("clampNote", () => {
  const range = { key: "quantity", min: 1, max: 200 } as const;

  it("says the range and the value it was set to", () => {
    expect(clampNote({ ...range, kind: "clamped", value: 200 }, "Quantity")).toBe("Quantity is 1–200; set to 200");
  });

  it("says a count was rounded", () => {
    expect(clampNote({ ...range, kind: "rounded", value: 4 }, "Quantity")).toBe("Quantity is a whole number; set to 4");
  });

  it("says a value was not a number and what was kept, with units", () => {
    const gap = { key: "partGapMm", kind: "rejected", value: 50, min: 0, max: 300 } as const;
    expect(clampNote(gap, "Gap", (v) => `${v} mm`)).toBe("Not a number; kept 50 mm");
    expect(clampNote({ ...gap, kind: "clamped", value: 300 }, "Gap", (v) => `${v} mm`)).toBe("Gap is 0 mm–300 mm; set to 300 mm");
  });
});
