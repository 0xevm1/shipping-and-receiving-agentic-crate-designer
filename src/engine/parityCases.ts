import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS, type Ranking } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { planTotal, sweepQuantities } from "@/domain/sweep";
import { catalogPart } from "@/lib/part";
import { canonicalJson } from "./canonical";
import { cutList, designShipment } from "./engine";
import { totalSplitOfPlan, withTotal } from "./request";
import type { DesignRequest, DesignSummary } from "./schemas";
import { sha256Text } from "./sha256";

/**
 * The browser/Node parity cases (spec §5.1, §10): every sample part at each of its suggested
 * quantities, run through the engine. `parity.node.test.ts` and `parity.jsdom.test.ts` both
 * compare this against the one committed baseline, `__snapshots__/parity.json`, so the two
 * runtimes agree with each other and with the app as it was when the baseline was written.
 */
export interface ParityCase {
  part: string;
  /** Set on a case for a job's total quantity (#140): `quantity` is then the parts to ship, and the request carries `planTotal`'s split. */
  total?: number;
  /** Set on a case run under a per-crate size limit (#108); absent for the default standards. */
  sizeLimitMm?: { length: number; width: number; height: number };
  quantity: number;
  inputHash: string;
  summary: DesignSummary;
  /** SHA-256 of the whole plan's canonical JSON: every board, cut-list line and check. */
  planHash: string;
  csv: { imperial: string; metric: string; shipment?: string };
}

export const parityRequest = (id: string, quantity: number, ranking: Ranking = "volume"): DesignRequest => {
  const p = catalog.parts.find((x) => x.id === id)!;
  return { part: catalogPart(p), settings: { ...DEFAULT_SETTINGS, quantity }, standards: DEFAULT_STANDARDS, layoutKey: null, ranking };
};

/** The request for a job's `total` parts of a sample part: `planTotal`'s split over the part's full sweep, as the browser and the server build it (#140). */
export function totalParityRequest(id: string, total: number): DesignRequest {
  const base = parityRequest(id, 1);
  const plan = planTotal(sweepQuantities(base.part, base.settings, base.standards), total)!;
  return withTotal(base, totalSplitOfPlan(plan));
}

/** Totals planned and designed whole: the part and the parts to ship. */
const TOTAL_CASES = [
  { part: "PART-001", total: 10000 },
  { part: "PART-002", total: 1000 },
  { part: "PART-003", total: 1000 },
] as const;

/** A pallet-position limit that splits a batch of 8 of PART-003, which one crate would not fit (#108). */
const SIZE_LIMIT_CASE = { part: "PART-003", quantity: 8, sizeLimitMm: { length: 1200, width: 800, height: 1000 } } as const;

export function parityCases(): ParityCase[] {
  const runs = [...catalog.parts.flatMap((p) => p.suggested_quantities.map((quantity) => ({ part: p.id, quantity, sizeLimitMm: undefined }))), SIZE_LIMIT_CASE];
  const totals = TOTAL_CASES.map(({ part, total }) => ({ part, quantity: total, total, sizeLimitMm: undefined }));
  return [...runs.map((r) => ({ ...r, total: undefined })), ...totals].map(({ part, quantity, sizeLimitMm, total }) => {
    const base = total ? totalParityRequest(part, total) : parityRequest(part, quantity);
    const req = sizeLimitMm
      ? {
          ...base,
          standards: { ...base.standards, limits: { ...base.standards.limits, perCrate: { ...base.standards.limits.perCrate, maxOutsideMm: sizeLimitMm } } },
        }
      : base;
    const out = designShipment(req);
    const csv = (units: "imperial" | "metric", scope: "crate" | "shipment" = "crate") => cutList({ ...req, units, scope, crateIndex: 0 }, out.plan).csv;
    return {
      part,
      ...(total ? { total } : {}),
      ...(sizeLimitMm ? { sizeLimitMm } : {}),
      quantity,
      inputHash: out.inputHash,
      summary: out.summary,
      planHash: sha256Text(canonicalJson(out.plan)),
      csv: { imperial: csv("imperial"), metric: csv("metric"), ...(out.plan.split || total ? { shipment: csv("imperial", "shipment") } : {}) },
    };
  });
}

/** The baseline's text: stable key order and a trailing newline, as Prettier leaves JSON. */
export const parityText = (cases: ParityCase[]) => `${JSON.stringify(cases, null, 2)}\n`;
