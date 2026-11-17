import { describe, expect, it } from "vitest";
import { quantityCapNote } from "./quantityCap";

describe("quantityCapNote", () => {
  it("says the cap, the number to ship and where to go", () => {
    expect(quantityCapNote(500, 200, true)).toEqual({
      text: "One crate holds at most 200. To ship 500, use Parts to ship on the Overview.",
      prefill: 500,
      action: "Go to Parts to ship",
    });
  });

  it("rounds a fractional number and uses thousands separators", () => {
    const note = quantityCapNote(2500.4, 200, true);
    expect(note.text).toContain("To ship 2,500,");
    expect(note.prefill).toBe(2500);
  });

  it("does not point at a field that is not there", () => {
    const note = quantityCapNote(500, 200, false);
    expect(note.action).toBeNull();
    expect(note.text).toContain("once the shared job is connected");
    expect(note.prefill).toBe(500);
  });

  it("does not prefill a total over Parts to ship's own cap", () => {
    const note = quantityCapNote(50_000, 200, true);
    expect(note.prefill).toBeNull();
    expect(note.text).toBe("One crate holds at most 200. Parts to ship on the Overview takes up to 10,000.");
    expect(note.action).toBe("Go to Parts to ship");
    expect(quantityCapNote(50_000, 200, false).action).toBeNull();
  });
});
