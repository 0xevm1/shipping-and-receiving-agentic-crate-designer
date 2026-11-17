import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPart } from "@/domain/catalog";
import { sweepFor } from "@/engine/artifacts";
import { inputHash } from "@/engine/engine";
import { parityRequest } from "@/engine/parityCases";
import type { ConfigurationResponse } from "@/lib/api/jobs";
import { catalogPart } from "@/lib/part";
import { ERROR_NOTE_MS } from "./exportRun";
import { defaultConfigs, savedConfigRequests, shortlistConfigs, useDownloadAll } from "./downloadAll";
import { toSavedConfig } from "./jobSync";

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

  it("turns a job's saved configurations into the requests they were saved with, on the part on screen", () => {
    const saved = [parityRequest("PART-002", 2), { ...parityRequest("PART-002", 4), layoutKey: null, ranking: "cost" as const }];
    const response = (req: (typeof saved)[number], i: number): ConfigurationResponse =>
      JSON.parse(
        JSON.stringify({
          id: `00000000-0000-4000-8000-00000000000${i}`,
          inputHash: inputHash(req),
          engineVersion: "x",
          quantityPerCrate: req.settings.quantity,
          layout: "auto",
          score: null,
          origin: "user",
          summary: null,
          design: { settings: req.settings, layoutKey: req.layoutKey, ranking: req.ranking, part: req.part, standards: req.standards },
          createdAt: "2026-11-17T12:00:00.000Z",
          addedAt: "2026-11-17T12:00:00.000Z",
        }),
      );
    const broken = toSavedConfig({ ...response(saved[0]!, 9), design: { settings: { quantity: -1 }, layoutKey: null, ranking: "volume" } });
    const configs = [...saved.map((r, i) => toSavedConfig(response(r, i))), broken];
    // The part on screen: the same catalog part, loaded with its model URL and scale.
    const current = { ...parityRequest("PART-002", 7), part: catalogPart(getPart("PART-002")) };

    const requests = savedConfigRequests(configs, current);
    expect(requests).toHaveLength(2);
    expect(requests.map(inputHash)).toEqual(configs.slice(0, 2).map((c) => c.inputHash));
    expect(requests.map((r) => r.settings.quantity)).toEqual([2, 4]);
    expect(requests[1]!.ranking).toBe("cost");
    expect(requests.every((r) => (r.part as typeof current.part).modelUrl === current.part.modelUrl)).toBe(true);

    // Without a list, Download all bundles the design on screen and the job's configurations; the sweep isn't run.
    const sweep = vi.fn(() => sweepFor(current));
    expect(defaultConfigs(current, configs, sweep)).toEqual([current, ...requests]);
    expect(sweep).not.toHaveBeenCalled();
    // With nothing saved (or no job), the shortlist as before.
    expect(defaultConfigs(current, [broken], sweep)).toEqual(shortlistConfigs(current, sweepFor(current)));
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
