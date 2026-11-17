import type { Ranking } from "@/domain/design";
import type { CrateSettings, DesignPart } from "@/domain/schema";
import { TotalSplitSchema, type TotalSplit } from "@/domain/shipment";
import type { ShopStandards } from "@/domain/standards";
import { candidateQuantities, type TotalPlan } from "@/domain/sweep";
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
  const { restingFaces, maxLayers, partGapMm, wallClearanceMm, panelThickness } = input.rules;
  return {
    part: designPartOf(input.part),
    rules: { restingFaces, maxLayers, partGapMm, wallClearanceMm, panelThickness },
    standards: input.standards,
    candidates: candidateQuantities(input.part.suggested_quantities),
    ...(input.freightRates !== undefined ? { freightRates: input.freightRates } : {}),
    ...(input.maxQuantity !== undefined ? { maxQuantity: input.maxQuantity } : {}),
    ...(input.total !== undefined ? { total: input.total } : {}),
  };
}

/**
 * The crate types of a job's total (`planTotal`'s answer, or the server's stored one) as the split a
 * design request carries (#140). Null when there is no plan to carry: no types, or types that don't
 * make up `parts` (a plan from another total).
 */
export function totalSplitFor(parts: number, types: readonly { count: number; quantity: number; layoutKey: string | null }[]): TotalSplit | null {
  const r = TotalSplitSchema.safeParse({ parts, types: types.map((t) => ({ count: t.count, quantity: t.quantity, layoutKey: t.layoutKey })) });
  return r.success ? r.data : null;
}

/** A `planTotal` answer as the split a request carries (#140). */
export function totalSplitOfPlan(plan: TotalPlan): TotalSplit {
  return { parts: plan.total, types: plan.types.map((t) => ({ count: t.count, quantity: t.quantity, layoutKey: t.crate.layoutKey })) };
}

/**
 * `req` for a job's whole shipment (#140): the same part, rules and standards with the total's crate
 * types, so every file built from it describes the total. The quantity and layout pick are not read
 * when a total is set, so they are fixed (the fuller crate's quantity, the recommended layout and the
 * volume ranking): requests for one total from different edits of the crate on screen are one
 * request, with one `inputHash`, in the browser and on the server. Without a total, `req` as it is.
 */
export function withTotal(req: DesignRequest, total: TotalSplit | null | undefined): DesignRequest {
  if (!total) return req;
  return { ...req, settings: { ...req.settings, quantity: total.types[0].quantity }, layoutKey: null, ranking: "volume", total };
}

/** The design request for a part at one set of rules (the quantity is `settings.quantity`), or for the whole shipment of a `total` (`withTotal`). */
export function designRequestFor(input: {
  part: DesignPart;
  settings: CrateSettings;
  standards: ShopStandards;
  layoutKey: string | null;
  ranking: Ranking;
  total?: TotalSplit | null;
}): DesignRequest {
  const req: DesignRequest = {
    part: designPartOf(input.part),
    settings: input.settings,
    standards: input.standards,
    layoutKey: input.layoutKey,
    ranking: input.ranking,
  };
  return withTotal(req, input.total);
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
