import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { planShipment, withinSizeLimit } from "@/domain/shipment";
import { planTotal, sweepQuantities } from "@/domain/sweep";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { custom } from "@/domain/testFixtures";
import { explainTotalPlan } from "@/domain/totalPlan";
import { ENGINE_VERSION } from "@/engine/version";
import { MAX_TOTAL_QUANTITY } from "@/lib/api/designs";
import type { TotalPlanResponse } from "@/lib/api/jobs";
import { metricText } from "@/lib/message";
import { parseTotal, totalPlanView, wholeShipment } from "./totalPlan";

const sweep = sweepQuantities(getPart("PART-001"), DEFAULT_SETTINGS);
const CONFIG_A = "00000000-0000-4000-8000-0000000000a1";
const CONFIG_B = "00000000-0000-4000-8000-0000000000b2";

/** The server's record of the same plan, as the sweep job stores it. */
function serverPlan(total: number, from = sweep): TotalPlanResponse {
  const plan = planTotal(from, total)!;
  return {
    total,
    engineVersion: ENGINE_VERSION,
    inputHash: "f".repeat(64),
    basis: "crate-only",
    computedAt: "2026-11-17T09:00:00.000Z",
    plan: {
      crates: plan.crates,
      perCrate: plan.perCrate,
      types: plan.types.map((t, i) => ({
        label: t.label,
        count: t.count,
        quantity: t.quantity,
        layoutKey: t.crate.layoutKey,
        configurationId: i ? CONFIG_B : CONFIG_A,
      })),
      crateCostUsd: plan.crateCostUsd,
      freightUsd: null,
      scoreUsdPerPart: plan.scoreUsdPerPart,
    },
    rationale: [...explainTotalPlan(from, total, plan)],
  };
}

describe("parseTotal", () => {
  it("takes a whole number of parts, empty for none, and refuses anything else", () => {
    expect(parseTotal(" 40 ")).toBe(40);
    expect(parseTotal("")).toBeNull();
    expect(parseTotal("0")).toBeUndefined();
    expect(parseTotal("2.5")).toBeUndefined();
    expect(parseTotal("abc")).toBeUndefined();
    expect(parseTotal(String(MAX_TOTAL_QUANTITY + 1))).toBeUndefined();
  });
});

describe("totalPlanView", () => {
  it("shows nothing without a total", () => {
    expect(totalPlanView({ total: null, sweep, server: null })).toMatchObject({ total: null, shown: null, other: null, serverPending: false });
  });

  it("plans in the browser at once, from the sweep, while the server hasn't planned yet", () => {
    const v = totalPlanView({ total: 40, sweep, server: null });
    const plan = planTotal(sweep, 40)!;
    expect(v.shown).toMatchObject({ source: "browser", total: 40, scoreUsdPerPart: plan.scoreUsdPerPart });
    expect(v.shown!.headline).toMatch(/^40 parts → .+, \$\d+\.\d{2} per part$/);
    expect(v.shown!.crates.map((c) => c.count * c.quantity).reduce((a, b) => a + b, 0)).toBe(40);
    expect(v.shown!.crates.every((c) => c.configurationId === null)).toBe(true);
    expect(metricText(v.shown!.rationale)).toBe(metricText(explainTotalPlan(sweep, 40)));
    expect(v).toMatchObject({ serverPending: true, other: null, browserPending: false });
  });

  it("shows one plan when the browser and the server agree, with the server's configurations", () => {
    const v = totalPlanView({ total: 40, sweep, server: serverPlan(40) });
    expect(v.shown!.source).toBe("both");
    expect(v.shown!.crates[0].configurationId).toBe(CONFIG_A);
    expect(v.other).toBeNull();
    expect(v.serverPending).toBe(false);
  });

  it("shows both, labelled, when the server's rules or standards make a different plan", () => {
    const base = serverPlan(40);
    const server = { ...base, plan: { ...base.plan!, scoreUsdPerPart: base.plan!.scoreUsdPerPart + 1 } };
    const v = totalPlanView({ total: 40, sweep, server });
    expect(v.shown!.source).toBe("browser");
    expect(v.other!.source).toBe("server");
    expect(v.other!.crates[0].configurationId).toBe(CONFIG_A);
  });

  it("never shows a server plan for another total, and uses the server's alone without a sweep", () => {
    const stale = totalPlanView({ total: 41, sweep: null, server: serverPlan(40) });
    expect(stale).toMatchObject({ shown: null, serverPending: true, browserPending: true });
    const serverOnly = totalPlanView({ total: 40, sweep: null, server: serverPlan(40) });
    expect(serverOnly.shown!.source).toBe("server");
  });

  it("leaves a total past the field's maximum to the server", () => {
    const v = totalPlanView({ total: MAX_TOTAL_QUANTITY + 1, sweep, server: null });
    expect(v.shown).toBeNull();
  });

  it("says when there is no plan", () => {
    const none = { ...sweep, curve: sweep.curve.map((p) => ({ ...p, ok: false, crate: null, reason: ["Too heavy."] })) };
    const v = totalPlanView({ total: 5, sweep: none, server: null });
    expect(v.shown!.headline).toBe("5 parts → no plan passes every check");
    expect(v.shown!.crates).toEqual([]);
  });
});

describe("Parts to ship under a per-crate size limit (#108)", () => {
  const limited = custom({ limits: { perCrate: { maxOutsideMm: { length: 1000, width: 700, height: 700 } } } });
  const limitedSweep = sweepQuantities(getPart("PART-001"), DEFAULT_SETTINGS, limited);

  it("splits so no crate is over the limit", () => {
    const view = totalPlanView({ total: 40, sweep: limitedSweep, server: null });
    const plain = totalPlanView({ total: 40, sweep, server: null });
    expect(view.shown!.crates.reduce((n, c) => n + c.count * c.quantity, 0)).toBe(40);
    for (const c of view.shown!.crates) {
      const d = planShipment(getPart("PART-001"), { ...DEFAULT_SETTINGS, quantity: c.quantity }, c.layoutKey, limited).crates[0].result.design!;
      expect(withinSizeLimit(d.layout.external, limited)).toBe(true);
    }
    expect(Math.max(...view.shown!.crates.map((c) => c.quantity))).toBeLessThan(Math.max(...plain.shown!.crates.map((c) => c.quantity)));
  });
});

describe("wholeShipment (#140)", () => {
  const part = getPart("PART-001");
  const screen = { part, settings: { ...DEFAULT_SETTINGS, quantity: 8 }, standards: DEFAULT_STANDARDS };
  const onScreen = planShipment(part, screen.settings, null, DEFAULT_STANDARDS);

  it("is the plan on screen while Parts to ship is not set", () => {
    const w = wholeShipment({ ...screen, plan: onScreen }, totalPlanView({ total: null, sweep, server: null }));
    expect(w.total).toBeNull();
    expect(w.plan).toBe(onScreen);
  });

  it("is the total's plan: its parts, crates and cost, not the plan of the 200 on screen", () => {
    const view = totalPlanView({ total: 10000, sweep, server: null });
    const w = wholeShipment({ ...screen, plan: planShipment(part, { ...screen.settings, quantity: 200 }, null, DEFAULT_STANDARDS) }, view);
    const mine = planTotal(sweep, 10000)!;
    expect(w.total).toEqual({ parts: 10000, types: mine.types.map((t) => ({ count: t.count, quantity: t.quantity, layoutKey: t.crate.layoutKey })) });
    expect(w.plan.total).toBe(10000);
    expect(w.plan.totals).toMatchObject({ parts: 10000, crates: mine.crates });
    expect(w.plan.totals.costUsd).toBeCloseTo(mine.crateCostUsd, 6);
  });

  it("follows the server's plan while this browser's sweep is not there yet", () => {
    const w = wholeShipment({ ...screen, plan: onScreen }, totalPlanView({ total: 100, sweep: null, server: serverPlan(100) }));
    expect(w.plan.totals.parts).toBe(100);
  });

  it("falls back to the plan on screen when no plan passes every check", () => {
    const failing = { ...sweep, curve: sweep.curve.map((p) => ({ ...p, ok: false })) };
    const w = wholeShipment({ ...screen, plan: onScreen }, totalPlanView({ total: 100, sweep: failing, server: null }));
    expect(w.total).toBeNull();
    expect(w.plan).toBe(onScreen);
  });
});
