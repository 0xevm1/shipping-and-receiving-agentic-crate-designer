import type { Ranking } from "@/domain/design";
import type { CrateSettings, DesignPart } from "@/domain/schema";
import type { ShopStandards } from "@/domain/standards";
import { candidateQuantities } from "@/domain/sweep";
import { canonicalJson } from "./canonical";
import { designPartOf } from "./engine";
import type { DesignRequest } from "./schemas";
import { sha256Text } from "./sha256";
import type { SweepRequest } from "./sweep";

/**
 * The one place an engine request is built (spec §5.1, #46 "same inputs"): the browser's store
 * (`store.ts` designs, `bestQuantity.ts` sweeps, `jobSync.ts` saves) and every server-side engine
 * call (the queue's sweep job, `POST /api/v1/designs`, the CLI) go through these, so the two sides
 * can't build different requests from the same part. The part is cut to its design fields
 * (`designPartOf`: id, name, mass, size, material and the measured outline, spec §7.5b): a
 * loaded part's model URL and load facts are never inputs. What the server doesn't have of the
 * browser's part (the measured outline above all) the browser sends with the job
 * (`PUT /api/v1/jobs/:id/part`), and the server designs from that.
 */

/** The packing rules a sweep holds fixed: every setting but the quantity. */
export type SweepRules = Omit<CrateSettings, "quantity">;

/**
 * The sweep request for a part, its packing rules and the shop standards. The recommendation
 * chooses among the part's suggested quantities (#133): `candidates` is set here, from the part's
 * `suggested_quantities` (1, 4 and 8 when it has none), so the browser, the server's queue job,
 * `POST /designs` and the CLI send the same ones for the same part.
 */
export function sweepRequestFor(input: {
  part: DesignPart;
  rules: SweepRules;
  standards: ShopStandards;
  freightRates?: SweepRequest["freightRates"];
  maxQuantity?: number;
  total?: number | null;
}): SweepRequest {
  const { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness } = input.rules;
  return {
    part: designPartOf(input.part),
    rules: { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness },
    standards: input.standards,
    candidates: candidateQuantities(input.part.suggested_quantities),
    ...(input.freightRates !== undefined ? { freightRates: input.freightRates } : {}),
    ...(input.maxQuantity !== undefined ? { maxQuantity: input.maxQuantity } : {}),
    ...(input.total !== undefined ? { total: input.total } : {}),
  };
}

/** The design request for a part at one set of rules (the quantity is `settings.quantity`). */
export function designRequestFor(input: {
  part: DesignPart;
  settings: CrateSettings;
  standards: ShopStandards;
  layoutKey: string | null;
  ranking: Ranking;
}): DesignRequest {
  return { part: designPartOf(input.part), settings: input.settings, standards: input.standards, layoutKey: input.layoutKey, ranking: input.ranking };
}

/** Bumped when the hashed shape of a design part changes. 2: the part's centre of gravity (`cog`, #110). */
const PART_HASH_SCHEMA = 2;

/**
 * SHA-256 of a part's design fields (canonical JSON): the version of the part a job's server-side
 * results were computed from (`design_job.design_part_hash`, `configuration.part_hash`). Equal
 * parts hash the same in every runtime.
 */
export function designPartHash(part: DesignPart): string {
  return sha256Text(canonicalJson({ v: PART_HASH_SCHEMA, part: designPartOf(part) }));
}
