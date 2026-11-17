import { describe, expect, it } from "vitest";
import { IDLE_MS, isDeliberateInput, isViewInput, VIEW_INPUT_SELECTOR } from "./motion";

describe("idle input", () => {
  it("idles after 5 s", () => {
    expect(IDLE_MS).toBe(5000);
  });

  it("counts clicks, taps, the wheel and keys", () => {
    for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) expect(isDeliberateInput({ type }), type).toBe(true);
  });

  it("counts a drag but not a hover", () => {
    expect(isDeliberateInput({ type: "pointermove", buttons: 1 })).toBe(true);
    expect(isDeliberateInput({ type: "pointermove", buttons: 0 })).toBe(false);
    expect(isDeliberateInput({ type: "pointermove" })).toBe(false);
  });

  it("ignores other events", () => {
    expect(isDeliberateInput({ type: "pointerover" })).toBe(false);
  });

  it("only counts input aimed at a 3D canvas or a view control", () => {
    const inside = { closest: (sel: string) => (sel === VIEW_INPUT_SELECTOR ? {} : null) };
    const outside = { closest: () => null };
    expect(isViewInput(inside)).toBe(true);
    // A click in the island or the header, or a key pressed with nothing focused (the target is the body).
    expect(isViewInput(outside)).toBe(false);
    // Targets that aren't elements: the window, the document, nothing.
    expect(isViewInput({})).toBe(false);
    expect(isViewInput(null)).toBe(false);
  });

  it("names canvases and marked view controls", () => {
    expect(VIEW_INPUT_SELECTOR).toBe("canvas, [data-view-input]");
  });
});
