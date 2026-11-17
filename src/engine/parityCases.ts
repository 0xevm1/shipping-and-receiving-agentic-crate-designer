import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS, type Ranking } from "@/domain/design";
import type { ForkEntry } from "@/domain/forkEntry";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { catalogPart } from "@/lib/part";
import { canonicalJson } from "./canonical";
import { cutList, designShipment } from "./engine";
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
  /** Set on a case run under a per-crate size limit (#108); absent for the default standards. */
  sizeLimitMm?: { length: number; width: number; height: number };
  /** Set on a case run with side or four-way fork entry (#112); absent for the default, end entry. */
  forkEntry?: ForkEntry;
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

/** A pallet-position limit that splits a batch of 8 of PART-003, which one crate would not fit (#108). */
const SIZE_LIMIT_CASE = { part: "PART-003", quantity: 8, sizeLimitMm: { length: 1200, width: 800, height: 1000 } } as const;

/** Side and four-way fork entry, on a crate a pallet jack fits (PART-003 x 8) and one only a forklift does (PART-001 x 1) (#112). */
const FORK_ENTRY_CASES = [
  { part: "PART-003", quantity: 8, forkEntry: "sides" },
  { part: "PART-003", quantity: 8, forkEntry: "fourWay" },
  { part: "PART-001", quantity: 1, forkEntry: "sides" },
  { part: "PART-001", quantity: 1, forkEntry: "fourWay" },
] as const;

export function parityCases(): ParityCase[] {
  const runs: { part: string; quantity: number; sizeLimitMm?: (typeof SIZE_LIMIT_CASE)["sizeLimitMm"]; forkEntry?: ForkEntry }[] = [
    ...catalog.parts.flatMap((p) => p.suggested_quantities.map((quantity) => ({ part: p.id, quantity }))),
    SIZE_LIMIT_CASE,
    ...FORK_ENTRY_CASES,
  ];
  return runs.map(({ part, quantity, sizeLimitMm, forkEntry }) => {
    const base = parityRequest(part, quantity);
    const sized = sizeLimitMm
      ? {
          ...base,
          standards: { ...base.standards, limits: { ...base.standards.limits, perCrate: { ...base.standards.limits.perCrate, maxOutsideMm: sizeLimitMm } } },
        }
      : base;
    const req = forkEntry ? { ...sized, standards: { ...sized.standards, handling: { ...sized.standards.handling, forkEntry } } } : sized;
    const out = designShipment(req);
    const csv = (units: "imperial" | "metric", scope: "crate" | "shipment" = "crate") => cutList({ ...req, units, scope, crateIndex: 0 }, out.plan).csv;
    return {
      part,
      ...(sizeLimitMm ? { sizeLimitMm } : {}),
      ...(forkEntry ? { forkEntry } : {}),
      quantity,
      inputHash: out.inputHash,
      summary: out.summary,
      planHash: sha256Text(canonicalJson(out.plan)),
      csv: { imperial: csv("imperial"), metric: csv("metric"), ...(out.plan.split ? { shipment: csv("imperial", "shipment") } : {}) },
    };
  });
}

/** The baseline's text: stable key order and a trailing newline, as Prettier leaves JSON. */
export const parityText = (cases: ParityCase[]) => `${JSON.stringify(cases, null, 2)}\n`;
