import { describe, expect, it } from "vitest";
import { FOCUSABLE, trapTarget } from "./useFocusTrap";

describe("trapTarget", () => {
  const items = ["a", "b", "c"];
  it("lets Tab move between the ends", () => {
    expect(trapTarget(items, "a", false)).toBeNull();
    expect(trapTarget(items, "b", true)).toBeNull();
  });
  it("wraps at both ends", () => {
    expect(trapTarget(items, "c", false)).toBe("a");
    expect(trapTarget(items, "a", true)).toBe("c");
  });
  it("brings focus from outside to the first item", () => {
    expect(trapTarget(items, null, false)).toBe("a");
    expect(trapTarget(items, "x", true)).toBe("a");
  });
  it("does nothing with no focusable items", () => {
    expect(trapTarget([], null, false)).toBeNull();
  });
});

describe("FOCUSABLE", () => {
  it("includes the toggle of a details element and editable regions", () => {
    expect(FOCUSABLE).toContain("summary");
    expect(FOCUSABLE).toContain("[contenteditable]");
  });
});
