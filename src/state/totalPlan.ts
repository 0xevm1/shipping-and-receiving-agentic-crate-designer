import { useMemo } from "react";
import type { Message } from "@/domain/message";
import { planTotal, type QuantitySweep } from "@/domain/sweep";
import { explainTotalPlan, planText } from "@/domain/totalPlan";
import { MAX_TOTAL_QUANTITY } from "@/lib/api/designs";
import type { TotalPlanResponse } from "@/lib/api/jobs";
import { useBestQuantity } from "./bestQuantity";
import { useJobSync } from "./jobSync";
import { changesFor, effectiveJob, usePendingChanges } from "./pendingChanges";

/**
 * The job's total quantity and how it ships (spec §7.16), for the shared job section and the
 * Overview. Two plans can exist, made by the same engine (`planTotal`) over two sweeps:
 *
 * - **this browser's**, over the sweep the engine worker keeps for the part and the packing rules
 *   on screen (`useBestQuantity`): instant, and offline;
 * - **the server's**, the shared record (`GET /jobs/:id` `totalPlan`), over the server's sweep
 *   with the job's standards and the default packing rules.
 *
 * Both sweep the same part: the browser sends its part, measured outline included, to the job
 * (#46 "same inputs", `PUT /jobs/:id/part`), and the server designs from it through the engine's
 * one request builder. So with the same rules and standards they are the same plan, and one is
 * shown (with the server's configuration ids, for its files). They differ only when the rules or
 * standards on screen differ from the server's (or while the server re-plans a part that just
 * changed); then both are shown, each labelled.
 */

/** One crate type of a plan as shown. */
export interface PlanCrateView {
  label: string;
  count: number;
  quantity: number;
  layoutKey: string;
  /** The server's configuration for it (files, "Use"), when the server's plan is the one shown or agrees. */
  configurationId: string | null;
}

export interface PlanView {
  /** Whose plan: this browser's, the server's, or both (they agree). */
  source: "browser" | "server" | "both";
  total: number;
  /** "40 parts → 2 crates × 20, $20.51 per part", or why there is no plan. */
  headline: string;
  rationale: Message;
  crates: PlanCrateView[];
  scoreUsdPerPart: number | null;
}

export interface TotalPlanView {
  /** The total in effect on this device (the job's, with unsynced changes on top); null for none. */
  total: number | null;
  /** The total was changed on this device and hasn't synced yet. */
  unsynced: boolean;
  /** The plan to show first: this browser's when it has one, else the server's. */
  shown: PlanView | null;
  /** The server's plan, when it differs from `shown`. */
  other: PlanView | null;
  /** A total is set and the server hasn't planned it yet (or its plan is from another engine). */
  serverPending: boolean;
  /** This browser's sweep is still running for the rules on screen. */
  browserPending: boolean;
}

/**
 * The "Parts to ship" field's text as a total: a whole number of parts from 1 to
 * `MAX_TOTAL_QUANTITY` (the most the browser plans at once), null when it is empty (no total), or
 * undefined when it is neither.
 */
export function parseTotal(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= MAX_TOTAL_QUANTITY ? n : undefined;
}

const usd = (v: number) => `$${v.toFixed(2)}`;
const cents = (v: number) => Math.round(v * 100);

function headline(total: number, plan: { crates: number; types: readonly { quantity: number; count: number }[]; scoreUsdPerPart: number } | null): string {
  if (!plan) return `${total} parts → no plan passes every check`;
  return `${total} parts → ${planText(plan)}, ${usd(plan.scoreUsdPerPart)} per part`;
}

// Total mode reads the sweep's full 1-200 curve, never its candidates (#133): how to pack N parts is
// a different question from which suggested quantity is cheapest.
function browserView(sweep: QuantitySweep, total: number): PlanView {
  const plan = planTotal(sweep, total);
  return {
    source: "browser",
    total,
    headline: headline(total, plan),
    rationale: explainTotalPlan(sweep, total, plan),
    crates: (plan?.types ?? []).map((t) => ({ label: t.label, count: t.count, quantity: t.quantity, layoutKey: t.crate.layoutKey, configurationId: null })),
    scoreUsdPerPart: plan?.scoreUsdPerPart ?? null,
  };
}

function serverView(p: TotalPlanResponse): PlanView {
  const plan = p.plan;
  return {
    source: "server",
    total: p.total,
    headline: headline(p.total, plan),
    rationale: p.rationale as Message,
    crates: (plan?.types ?? []).map((t) => ({ ...t })),
    scoreUsdPerPart: plan?.scoreUsdPerPart ?? null,
  };
}

/** Same crates (count, quantity and layout of each type) and the same cost per part to the cent. */
function samePlan(a: PlanView, b: PlanView): boolean {
  const key = (v: PlanView) => v.crates.map((c) => `${c.count}×${c.quantity}@${c.layoutKey}`).join("+");
  const score = (v: PlanView) => (v.scoreUsdPerPart === null ? null : cents(v.scoreUsdPerPart));
  return key(a) === key(b) && score(a) === score(b);
}

/**
 * What to show for `total`: this browser's plan from `sweep` (null while it hasn't answered),
 * the server's stored plan (`server`, ignored unless it is for this total). Pure.
 */
export function totalPlanView({
  total,
  unsynced = false,
  sweep,
  sweepCurrent = true,
  server,
}: {
  total: number | null | undefined;
  unsynced?: boolean;
  sweep: QuantitySweep | null;
  sweepCurrent?: boolean;
  server: TotalPlanResponse | null;
}): TotalPlanView {
  if (!total) return { total: null, unsynced, shown: null, other: null, serverPending: false, browserPending: false };
  // A total past what the field takes (set through the API) is left to the server: planning it
  // here would hold the page up.
  const mine = sweep && total <= MAX_TOTAL_QUANTITY ? browserView(sweep, total) : null;
  const theirs = server && server.total === total ? serverView(server) : null;
  const base = { total, unsynced, serverPending: !theirs, browserPending: !sweep || !sweepCurrent };
  if (mine && theirs && samePlan(mine, theirs)) {
    // One plan: the browser's words, the server's configurations.
    return { ...base, shown: { ...mine, source: "both", crates: theirs.crates }, other: null };
  }
  return { ...base, shown: mine ?? theirs, other: mine ? theirs : null };
}

/** The total in effect for the part on screen and whether it is still unsynced. */
function useJobTotal(): { total: number | null; unsynced: boolean } {
  const job = useJobSync((s) => s.job);
  const partKey = useJobSync((s) => s.partKey);
  const items = usePendingChanges((s) => s.items);
  const mine = changesFor(items, job?.id ?? null, partKey);
  const { totalQuantity } = effectiveJob(job, mine);
  const unsynced = mine.some((c) => c.kind === "patch" && c.changes.totalQuantity !== undefined && c.state !== "rejected");
  return { total: totalQuantity ?? null, unsynced };
}

/** `totalPlanView` for the part on screen. */
export function useTotalPlan(): TotalPlanView {
  const { total, unsynced } = useJobTotal();
  const { sweep, current } = useBestQuantity();
  const server = useJobSync((s) => s.totalPlan);
  return useMemo(() => totalPlanView({ total, unsynced, sweep, sweepCurrent: current, server }), [total, unsynced, sweep, current, server]);
}
