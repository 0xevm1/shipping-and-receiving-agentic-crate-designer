import { describe, expect, it } from "vitest";
import { IDLE_MS, isDeliberateInput } from "./motion";

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
});
