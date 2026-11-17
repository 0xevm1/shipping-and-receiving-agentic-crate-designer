import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SWEEP_RULES, rankConfigurations, type SweepRequest } from "@/engine/sweep";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { TotalPlanSchema } from "@/lib/api/jobs";
import { currentTotalPlan, totalPlanRecord } from "./totalPlan";

const p = getPart("PART-001");
const req: SweepRequest = { part: { ...p }, rules: DEFAULT_SWEEP_RULES, standards: DEFAULT_STANDARDS, total: 40 };
const report = rankConfigurations(req);
const ID = "00000000-0000-4000-8000-000000000001";

describe("totalPlanRecord", () => {
  it("stores the sweep's plan for the total, stamped, with each crate type's configuration", () => {
    const rec = totalPlanRecord(report, 40, () => ID, new Date("2026-11-17T09:00:00Z"));
    expect(TotalPlanSchema.parse(rec)).toEqual(rec);
    expect(rec).toMatchObject({ total: 40, engineVersion: report.engineVersion, inputHash: report.inputHash, computedAt: "2026-11-17T09:00:00.000Z" });
    expect(rec.plan!.types.reduce((s, t) => s + t.count * t.quantity, 0)).toBe(40);
    expect(rec.plan!.types.every((t) => t.configurationId === ID)).toBe(true);
    expect(rec.rationale).toEqual(report.total!.rationaleMessage);
    expect(report.total!.rationale.startsWith("40 parts ship as ")).toBe(true);
  });

  it("records why there is no plan", () => {
    const rec = totalPlanRecord({ ...report, total: null }, 40, () => null);
    expect(rec.plan).toBeNull();
    expect(rec.rationale).toEqual(["40 parts can't be planned: one part alone fails a hard check."]);
  });
});

describe("currentTotalPlan", () => {
  const stored = totalPlanRecord(report, 40, () => ID);

  it("serves the plan for the job's total from this engine", () => {
    expect(currentTotalPlan({ totalQuantity: 40, totalPlan: stored })).toEqual(stored);
  });

  it("never serves a plan for another total, another engine, no total, or one that doesn't parse", () => {
    expect(currentTotalPlan({ totalQuantity: 41, totalPlan: stored })).toBeNull();
    expect(currentTotalPlan({ totalQuantity: 40, totalPlan: { ...stored, engineVersion: "0.0.1+engine.old" } })).toBeNull();
    expect(currentTotalPlan({ totalQuantity: null, totalPlan: stored })).toBeNull();
    expect(currentTotalPlan({ totalQuantity: 40, totalPlan: null })).toBeNull();
    expect(currentTotalPlan({ totalQuantity: 40, totalPlan: { total: 40 } })).toBeNull();
  });
});
