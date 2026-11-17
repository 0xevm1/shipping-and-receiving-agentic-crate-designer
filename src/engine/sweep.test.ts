import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { planTotal, sweepQuantities } from "@/domain/sweep";
import { DesignsResponseSchema } from "@/lib/api/designs";
import { designShipment } from "./engine";
import { runWorkerRequest } from "./run";
import { DEFAULT_SWEEP_RULES, rankConfigurations, runSweep, SweepRequestSchema, sweepDesignRequest, sweepInputHash, type SweepRequest } from "./sweep";
import { ENGINE_VERSION } from "./version";

const request = (over: Partial<SweepRequest> = {}): SweepRequest => ({
  part: getPart("PART-001"),
  rules: DEFAULT_SWEEP_RULES,
  standards: DEFAULT_STANDARDS,
  ...over,
});
const RATES = { usdPerCwtByClass: { "50": 20, "85": 40, "400": 150 }, minimumUsd: 90 };

describe("the sweep as an engine call", () => {
  it("default rules are the app's settings without the quantity", () => {
    expect({ ...DEFAULT_SWEEP_RULES, quantity: DEFAULT_SETTINGS.quantity }).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SWEEP_RULES).not.toHaveProperty("quantity");
  });

  it("is the domain's sweep, stamped with the engine version and a hash of its inputs", () => {
    const out = runSweep(request({ total: 40 }));
    const direct = sweepQuantities(getPart("PART-001"), { ...DEFAULT_SETTINGS, quantity: 1 }, DEFAULT_STANDARDS);
    expect(out.sweep).toEqual(direct);
    expect(out.total).toEqual(planTotal(direct, 40));
    expect(out.engineVersion).toBe(ENGINE_VERSION);
    expect(out.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes every input that changes the answer, and nothing else", () => {
    const base = sweepInputHash(request());
    expect(sweepInputHash(request())).toBe(base);
    // Fields of a loaded part that aren't design inputs (its URL) don't count.
    expect(sweepInputHash(request({ part: { ...getPart("PART-001"), modelUrl: "/x.glb" } as SweepRequest["part"] }))).toBe(base);
    for (const over of [
      { rules: { ...DEFAULT_SWEEP_RULES, keepUpright: !DEFAULT_SWEEP_RULES.keepUpright } },
      { total: 12 },
      { maxQuantity: 50 },
      { freightRates: RATES },
    ]) {
      expect(sweepInputHash(request(over))).not.toBe(base);
    }
  });

  it("parses its request and refuses a bad one", () => {
    expect(SweepRequestSchema.parse(request())).toMatchObject({ rules: DEFAULT_SWEEP_RULES });
    expect(SweepRequestSchema.safeParse({ ...request(), maxQuantity: 0 }).success).toBe(false);
    expect(SweepRequestSchema.safeParse({ ...request(), rules: { ...DEFAULT_SWEEP_RULES, maxLayers: 0 } }).success).toBe(false);
  });

  it("runs in the worker message format", () => {
    const res = runWorkerRequest({ id: 7, op: "sweep", request: request({ maxQuantity: 8 }) });
    expect(res).toMatchObject({ id: 7, ok: true });
    expect(res.ok && "sweep" in res.output && res.output.sweep.curve).toHaveLength(8);
  });
});

describe("rankConfigurations: the headless answer", () => {
  const report = rankConfigurations(request({ total: 40, freightRates: RATES }));

  it("matches the API's response schema", () => {
    expect(DesignsResponseSchema.parse(report)).toEqual(report);
  });

  it("ranks the shortlist best first, rank 1 being the recommendation", () => {
    expect(report.configurations.length).toBeGreaterThan(0);
    expect(report.configurations.map((c) => c.rank)).toEqual(report.configurations.map((_, i) => i + 1));
    expect(report.configurations[0]!.quantityPerCrate).toBe(report.recommendation!.quantityPerCrate);
    const scores = report.configurations.map((c) => Math.round(c.scoreUsdPerPart * 100));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(report.basis).toBe("crate-and-freight");
    expect(report.configurations.every((c) => c.freightUsd !== null)).toBe(true);
  });

  it("each configuration is a full design whose hash the engine reproduces", () => {
    const req = request({ total: 40, freightRates: RATES });
    for (const c of report.configurations) {
      const again = designShipment(sweepDesignRequest(req, c.quantityPerCrate, c.layoutKey));
      expect(again.inputHash).toBe(c.inputHash);
      expect(again.summary.totals.crates).toBe(c.crates);
      // The planner keeps a batch whole on the sweep's layout (spec §7.10, §7.16): one crate, that layout.
      expect(c.crates).toBe(1);
      expect(again.summary.crates[0]!.layoutKey).toBe(c.layoutKey);
      expect(c.settings.quantity).toBe(c.quantityPerCrate);
    }
  });

  it("adds the even split with a total, and prices no freight without rates", () => {
    expect(report.total).toMatchObject({ total: 40 });
    expect(report.total!.types.reduce((n, t) => n + t.count * t.quantity, 0)).toBe(40);
    const noRates = rankConfigurations(request());
    expect(noRates.total).toBeNull();
    expect(noRates.basis).toBe("crate-only");
    expect(noRates.configurations.every((c) => c.freightUsd === null)).toBe(true);
    expect(noRates.recommendation!.rationale).toMatch(/no freight rates given/);
  });

  it("says what is wrong instead of throwing for a part it can't design for", () => {
    const bad = rankConfigurations(request({ part: { ...getPart("PART-001"), mass_kg: -1 } }));
    expect(bad.problem).not.toBeNull();
    expect(bad.configurations).toEqual([]);
    expect(bad.recommendation).toBeNull();
  });
});
