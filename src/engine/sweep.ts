import { z } from "zod";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { explainRecommendation } from "@/domain/explainRecommendation";
import { CrateSettingsSchema } from "@/domain/schema";
import { ShopStandardsSchema } from "@/domain/standards";
import { FreightRatesSchema, planTotal, SWEEP_MAX_QUANTITY, sweepQuantities, type QuantitySweep, type TotalPlan } from "@/domain/sweep";
import type { DesignsResponse, RankedConfiguration } from "@/lib/api/designs";
import { explainTotalPlan } from "@/domain/totalPlan";
import { explanationText } from "@/lib/explanation";
import { metricText } from "@/lib/message";
import { canonicalJson } from "./canonical";
import { designPartOf, designShipment } from "./engine";
import { designRequestFor } from "./request";
import { DesignPartSchema, EngineStampSchema, type DesignRequest, type EngineStamp } from "./schemas";
import { sha256Text } from "./sha256";
import { ENGINE_VERSION } from "./version";

/**
 * The quantity sweep as an engine call (spec §5.1, §7.16): `sweepQuantities` and `planTotal`
 * behind a request every runtime validates the same way, stamped like every engine output. The
 * browser runs it in its Web Worker (`useBestQuantity`), the server in a worker thread
 * (src/server/workers), the CLI in-process with `--offline`.
 */

/** The packing rules a sweep holds fixed: every setting but the quantity, which it varies. */
export const SweepRulesSchema = CrateSettingsSchema.omit({ quantity: true });

/** The app's default packing rules: what a headless sweep (API, queue, CLI) uses. */
export const DEFAULT_SWEEP_RULES: z.infer<typeof SweepRulesSchema> = SweepRulesSchema.parse(DEFAULT_SETTINGS);

export const SweepRequestSchema = z.object({
  part: DesignPartSchema,
  rules: SweepRulesSchema,
  standards: ShopStandardsSchema,
  /** Caller-supplied LTL rates; without them the score is crate cost per part only. */
  freightRates: FreightRatesSchema.nullable().optional(),
  /** Quantities tried, 1..maxQuantity (default `SWEEP_MAX_QUANTITY`). */
  maxQuantity: z.int().min(1).max(SWEEP_MAX_QUANTITY).optional(),
  /** A total number of parts to ship: adds `total`, the even split (#25). */
  total: z.int().positive().nullable().optional(),
});
export type SweepRequest = z.infer<typeof SweepRequestSchema>;

export const SweepResponseSchema = EngineStampSchema.extend({
  /** Made by the engine, so only its shape is checked here (as `DesignResponse.plan`). */
  sweep: z.custom<QuantitySweep>((v) => typeof v === "object" && v !== null && Array.isArray((v as QuantitySweep).curve)),
  total: z.custom<TotalPlan | null>((v) => v === null || (typeof v === "object" && Array.isArray((v as TotalPlan).types))),
});
export type SweepResponse = z.infer<typeof SweepResponseSchema>;

/** Bumped when the shape of the hashed sweep input changes. */
const SWEEP_HASH_SCHEMA = 1;

/** SHA-256 of the canonical sweep request; the part counts by its design fields only. */
export function sweepInputHash(req: SweepRequest): string {
  const { part, rules, standards, freightRates, maxQuantity, total } = req;
  return sha256Text(
    canonicalJson({
      v: SWEEP_HASH_SCHEMA,
      kind: "sweep",
      part: designPartOf(part),
      rules,
      standards,
      freightRates: freightRates ?? null,
      maxQuantity: maxQuantity ?? SWEEP_MAX_QUANTITY,
      total: total ?? null,
    }),
  );
}

const sweepStamp = (req: SweepRequest): EngineStamp => ({ engineVersion: ENGINE_VERSION, inputHash: sweepInputHash(req) });

/** The sweep (and, with `total`, the even split). Pure; never throws for valid input. */
export function runSweep(req: SweepRequest): SweepResponse {
  const sweep = sweepQuantities(req.part, { ...req.rules, quantity: 1 }, req.standards, {
    maxQuantity: req.maxQuantity,
    freightRates: req.freightRates ?? null,
  });
  const total = req.total ? planTotal(sweep, req.total) : null;
  return { ...sweepStamp(req), sweep, total };
}

/** The design request for one quantity per crate on the sweep, with the layout the sweep picked. */
export function sweepDesignRequest(req: SweepRequest, quantity: number, layoutKey: string | null): DesignRequest {
  return designRequestFor({ part: req.part, settings: { ...req.rules, quantity }, standards: req.standards, layoutKey, ranking: "cost" });
}

function totalRationale(sweep: QuantitySweep, total: TotalPlan) {
  const message = explainTotalPlan(sweep, total.total, total);
  return { rationale: metricText(message), rationaleMessage: [...message] };
}

/**
 * The headless answer (`POST /api/v1/designs`, the CLI, the queue's sweep job): the sweep, then
 * every shortlisted quantity designed in full with the layout the sweep chose, ranked best first.
 * Rank 1 is the recommendation. Pure; a few ms on top of the sweep.
 */
export function rankConfigurations(req: SweepRequest, swept: SweepResponse = runSweep(req)): DesignsResponse {
  const { sweep, total } = swept;
  const configurations: RankedConfiguration[] = sweep.shortlist.map((p, i) => {
    const crate = p.crate!;
    const design = designShipment(sweepDesignRequest(req, p.quantity, crate.layoutKey));
    const c = design.summary.crates[0];
    return {
      rank: i + 1,
      quantityPerCrate: p.quantity,
      layoutKey: crate.layoutKey,
      inputHash: design.inputHash,
      settings: { ...req.rules, quantity: p.quantity },
      scoreUsdPerPart: crate.scoreUsdPerPart,
      crateCostUsd: crate.crateCostUsd,
      freightUsd: crate.freightUsd,
      freightClass: crate.freightClass,
      densityLbFt3: crate.densityLbFt3,
      grossKg: crate.grossKg,
      tareKg: c?.tareKg ?? null,
      outsideMm: c?.outsideMm ?? null,
      screws: c?.screws ?? null,
      crates: Math.max(1, design.summary.totals.crates),
    };
  });
  const rec = sweep.recommendation;
  return {
    engineVersion: swept.engineVersion,
    inputHash: swept.inputHash,
    part: { name: req.part.name, massKg: req.part.mass_kg, sizeMm: [...req.part.dimensions_mm] },
    basis: sweep.basis,
    maxQuantity: sweep.maxQuantity,
    recommendation: rec
      ? {
          quantityPerCrate: rec.quantity,
          rationale: metricText(rec.rationale),
          stoppedBy: rec.stoppedBy ? { quantity: rec.stoppedBy.quantity, binding: rec.stoppedBy.binding, reason: metricText(rec.stoppedBy.reason) } : null,
          costLimited: rec.costLimited,
          explanation: explanationText(explainRecommendation(sweep, req.standards, req.rules, { measured: !!req.part.profile })!, "metric"),
        }
      : null,
    configurations,
    total: total
      ? {
          total: total.total,
          crates: total.crates,
          perCrate: total.perCrate,
          types: total.types.map((t) => ({ label: t.label, count: t.count, quantity: t.quantity, layoutKey: t.crate.layoutKey })),
          crateCostUsd: total.crateCostUsd,
          freightUsd: total.freightUsd,
          scoreUsdPerPart: total.scoreUsdPerPart,
          ...totalRationale(sweep, total),
        }
      : null,
    curve: sweep.curve.map((p) => ({ quantity: p.quantity, ok: p.ok, binding: p.binding, scoreUsdPerPart: p.crate?.scoreUsdPerPart ?? null })),
    problem: sweep.problem ? { id: sweep.problem.id, title: sweep.problem.title, detail: metricText(sweep.problem.detail) } : null,
  };
}
