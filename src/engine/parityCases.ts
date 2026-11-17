import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS, type Ranking } from "@/domain/design";
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

export function parityCases(): ParityCase[] {
  return catalog.parts.flatMap((p) =>
    p.suggested_quantities.map((quantity) => {
      const req = parityRequest(p.id, quantity);
      const out = designShipment(req);
      const csv = (units: "imperial" | "metric", scope: "crate" | "shipment" = "crate") => cutList({ ...req, units, scope, crateIndex: 0 }, out.plan).csv;
      return {
        part: p.id,
        quantity,
        inputHash: out.inputHash,
        summary: out.summary,
        planHash: sha256Text(canonicalJson(out.plan)),
        csv: { imperial: csv("imperial"), metric: csv("metric"), ...(out.plan.split ? { shipment: csv("imperial", "shipment") } : {}) },
      };
    }),
  );
}

/** The baseline's text: stable key order and a trailing newline, as Prettier leaves JSON. */
export const parityText = (cases: ParityCase[]) => `${JSON.stringify(cases, null, 2)}\n`;
