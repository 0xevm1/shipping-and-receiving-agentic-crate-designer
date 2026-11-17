import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sweepFor } from "@/engine/artifacts";
import { parityRequest } from "@/engine/parityCases";
import { ERROR_NOTE_MS } from "./exportRun";
import { shortlistConfigs, useDownloadAll } from "./downloadAll";

const built = vi.hoisted(() => ({ configs: null as unknown }));
vi.mock("@/engine/artifacts", async (orig) => ({
  ...(await orig<typeof import("@/engine/artifacts")>()),
  buildMultiBundleZip: async (configs: unknown) => {
    built.configs = configs;
    throw new Error("boom");
  },
}));

describe("download all", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useDownloadAll.setState({ state: { kind: "idle" } });
  });

  it("bundles the design on screen, then the sweep's shortlist at its quantities and layouts", () => {
    const current = parityRequest("PART-002", 2);
    const sweep = sweepFor(current);
    const configs = shortlistConfigs(current, sweep);
    expect(configs[0]).toBe(current);
    expect(configs.slice(1).map((c) => [c.settings.quantity, c.layoutKey])).toEqual(sweep.shortlist.map((p) => [p.quantity, p.crate!.layoutKey]));
    expect(configs.slice(1).every((c) => c.part === current.part && c.standards === current.standards)).toBe(true);
    expect(shortlistConfigs(current, null)).toEqual([current]);
  });

  it("takes any array of design requests, and a failure shows its message, then clears itself", async () => {
    const configs = [parityRequest("PART-003", 6)];
    await useDownloadAll.getState().run(configs);
    expect(built.configs).toBe(configs);
    expect(useDownloadAll.getState().state.kind).toBe("error");
    vi.advanceTimersByTime(ERROR_NOTE_MS);
    expect(useDownloadAll.getState().state.kind).toBe("idle");
  });
});
