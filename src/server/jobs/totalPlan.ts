/**
 * The job's stored total-quantity plan (#46, spec §7.16): what the sweep job writes to
 * `design_job.total_plan`, and the rule for serving it. A plan is current only for the job's
 * `totalQuantity` and the running `ENGINE_VERSION`; anything else is never served (the snapshot
 * says `totalPlan: null`, "still planning").
 */
import { ENGINE_VERSION } from "@/engine/version";
import type { DesignsResponse } from "@/lib/api/designs";
import { type TotalPlanResponse, TotalPlanSchema } from "@/lib/api/jobs";
import type { DesignJob } from "../db/repository";

/** The job's plan when it is current, else null. A stored plan that no longer parses is not current. */
export function currentTotalPlan(job: Pick<DesignJob, "totalQuantity" | "totalPlan">, engineVersion = ENGINE_VERSION): TotalPlanResponse | null {
  if (job.totalQuantity === null || !job.totalPlan) return null;
  const parsed = TotalPlanSchema.safeParse(job.totalPlan);
  if (!parsed.success) return null;
  const plan = parsed.data;
  return plan.total === job.totalQuantity && plan.engineVersion === engineVersion ? plan : null;
}

/**
 * The plan to store for `total` from a sweep report (`rankConfigurations` with `total`), with
 * each crate type's configuration id (`configurationIdOf(type)`, null when it has none).
 */
export function totalPlanRecord(
  report: Pick<DesignsResponse, "engineVersion" | "inputHash" | "basis" | "total" | "problem">,
  total: number,
  configurationIdOf: (t: { quantity: number; layoutKey: string }) => string | null,
  now = new Date(),
): TotalPlanResponse {
  const t = report.total;
  return {
    total,
    engineVersion: report.engineVersion,
    inputHash: report.inputHash,
    basis: report.basis,
    computedAt: now.toISOString(),
    plan: t
      ? {
          crates: t.crates,
          perCrate: t.perCrate,
          types: t.types.map((x) => ({ label: x.label, count: x.count, quantity: x.quantity, layoutKey: x.layoutKey, configurationId: configurationIdOf(x) })),
          crateCostUsd: t.crateCostUsd,
          freightUsd: t.freightUsd,
          scoreUsdPerPart: t.scoreUsdPerPart,
        }
      : null,
    rationale: t
      ? t.rationaleMessage
      : [
          report.problem
            ? `No crate can be designed for this part: ${report.problem.title}`
            : `${total} parts can't be planned: one part alone fails a hard check.`,
        ],
  };
}
