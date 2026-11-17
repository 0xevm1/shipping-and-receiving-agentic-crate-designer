import { describe, expect, it } from "vitest";
import { backoffDelay } from "./pgEventBus";

describe("listener backoff", () => {
  it("doubles from the initial delay up to the cap, with jitter between half and full", () => {
    expect(backoffDelay(0, 250, 10_000, () => 1)).toBe(250);
    expect(backoffDelay(3, 250, 10_000, () => 1)).toBe(2000);
    expect(backoffDelay(20, 250, 10_000, () => 1)).toBe(10_000);
    expect(backoffDelay(3, 250, 10_000, () => 0)).toBe(1000);
  });
});
