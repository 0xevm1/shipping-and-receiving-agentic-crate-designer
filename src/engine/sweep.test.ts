import { ANY_FACES } from "@/domain/orientations";
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
    for (const over of [{ rules: { ...DEFAULT_SWEEP_RULES, restingFaces: ANY_FACES } }, { total: 12 }, { maxQuantity: 50 }, { freightRates: RATES }]) {
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

  it("explains the recommendation in plain sentences, freight priced only with rates (§7.16)", () => {
    const why = report.recommendation!.explanation;
    expect(why.quantity).toBe(report.recommendation!.quantityPerCrate);
    expect(why.sections.map((s) => s.id)).toEqual(["compared", "score", "pick", "limit", "considerations"]);
    expect(why.costLines.find((l) => l.label === "Freight")!.value).toMatch(/^\$/);
    const plain = rankConfigurations(request()).recommendation!.explanation;
    expect(plain.costLines.find((l) => l.label === "Freight")!.value).toBe("Not priced");
  });

  it("says what is wrong instead of throwing for a part it can't design for", () => {
    const bad = rankConfigurations(request({ part: { ...getPart("PART-001"), mass_kg: -1 } }));
    expect(bad.problem).not.toBeNull();
    expect(bad.configurations).toEqual([]);
    expect(bad.recommendation).toBeNull();
  });
});

describe("the sweep under a per-crate size limit (#108)", () => {
  const standards = {
    ...DEFAULT_STANDARDS,
    limits: { ...DEFAULT_STANDARDS.limits, perCrate: { ...DEFAULT_STANDARDS.limits.perCrate, maxOutsideMm: { length: 1000, width: 700, height: 700 } } },
  };
  const outsideOk = (o: readonly number[] | null) => !!o && o[2] <= 700 && ((o[0] <= 1000 && o[1] <= 700) || (o[1] <= 1000 && o[0] <= 700));

  it("recommends and splits only into crates within the limit, and hashes it", () => {
    const req = request({ standards, total: 41 });
    expect(sweepInputHash(req)).not.toBe(sweepInputHash(request({ total: 41 })));
    const out = rankConfigurations(req);
    expect(out.configurations.length).toBeGreaterThan(0);
    for (const c of out.configurations) expect(outsideOk(c.outsideMm)).toBe(true);
    expect(out.recommendation!.quantityPerCrate).toBeLessThan(rankConfigurations(request()).recommendation!.quantityPerCrate);
    expect(out.total!.types.length).toBeGreaterThan(0);
    for (const t of out.total!.types) {
      const d = designShipment(sweepDesignRequest(req, t.quantity, t.layoutKey));
      expect(d.summary.crates).toHaveLength(1);
      expect(outsideOk(d.summary.crates[0].outsideMm)).toBe(true);
    }
  });

  it("validates a request without the field (an old stored row) as no limit", () => {
    const old = structuredClone(request()) as unknown as { standards: { limits: { perCrate: Record<string, unknown> } } };
    delete old.standards.limits.perCrate.maxOutsideMm;
    const parsed = SweepRequestSchema.parse(old);
    expect(parsed.standards.limits.perCrate.maxOutsideMm).toEqual({ length: 0, width: 0, height: 0 });
  });
});
