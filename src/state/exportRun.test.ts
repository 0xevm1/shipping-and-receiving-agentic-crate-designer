import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_NOTE_MS, useExportRun } from "./exportRun";

vi.mock("@/lib/exportBundle", () => ({
  buildBundle: async () => {
    throw new Error("boom");
  },
  zipBundle: () => new Uint8Array(),
}));

describe("export run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useExportRun.setState({ state: { kind: "idle" } });
  });

  it("a failure shows its message, then clears itself", async () => {
    await useExportRun.getState().run();
    expect(useExportRun.getState().state.kind).toBe("error");
    vi.advanceTimersByTime(ERROR_NOTE_MS - 1);
    expect(useExportRun.getState().state.kind).toBe("error");
    vi.advanceTimersByTime(1);
    expect(useExportRun.getState().state.kind).toBe("idle");
  });
});
