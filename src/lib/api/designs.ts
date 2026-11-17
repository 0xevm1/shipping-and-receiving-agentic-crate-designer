/**
 * Request and response shapes for `POST /api/v1/designs` (#46 slice 7): a stateless, headless
 * calculation. Pure Zod, so the server validates with them and the CLI (or any script) parses the
 * answer with the same schemas. docs/QUEUE.md "POST /api/v1/designs" has examples.
 *
 * POST /api/v1/designs   multipart/form-data, `Authorization: Bearer <key>` (docs/QUEUE.md "API keys"):
 *   file          the part's binary .glb (the same checks and messages as POST /api/v1/parts)
 *   mass          kg per part, required ("12.5" or "12.5 kg")
 *   material      optional text
 *   density       optional kg/m³
 *   name          optional; defaults to one made from the file name
 *   total         optional: the total number of parts to ship (adds `total`, an even split)
 *   freightRates  optional JSON: `{"usdPerCwtByClass": {"70": 41.5, ...}, "minimumUsd": 95}`.
 *                 Without it no freight dollars appear anywhere (spec §7.16)
 *
 * Nothing is saved: the answer is the ranked shortlist, the recommendation and the curve.
 */
import { z } from "zod";
import { CrateSettingsSchema, Vec3Schema } from "@/domain/schema";
import { FreightRatesSchema, SWEEP_CONSTRAINTS } from "@/domain/sweep";
import { CreatePartFieldsSchema } from "./parts";

/** The largest total quantity a headless call takes (a total plan tries every crate count up to it). */
export const MAX_TOTAL_QUANTITY = 10_000;

const field = z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string());

/** The text fields of a `/designs` call: the part fields of `/parts`, plus `total` and `freightRates`. */
export const DesignsFieldsSchema = CreatePartFieldsSchema.extend({
  total: field.transform((text, ctx) => {
    if (text === "") return undefined;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOTAL_QUANTITY) {
      ctx.addIssue({ code: "custom", message: `Total must be a whole number of parts from 1 to ${MAX_TOTAL_QUANTITY}.` });
      return z.NEVER;
    }
    return n;
  }),
  freightRates: field.transform((text, ctx) => {
    if (text === "") return undefined;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: 'Freight rates must be JSON, like {"usdPerCwtByClass": {"70": 41.5}}.' });
      return z.NEVER;
    }
    const parsed = FreightRatesSchema.safeParse(json);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `Freight rates: ${parsed.error.issues[0]?.message ?? "not valid"}.` });
      return z.NEVER;
    }
    return parsed.data;
  }),
});
export type DesignsFields = z.infer<typeof DesignsFieldsSchema>;

const hash = z.string().regex(/^[0-9a-f]{64}$/);

/** `ExplanationText` (src/lib/explanation.ts): the recommendation explained in plain sentences. */
export const ExplanationSchema = z.object({
  quantity: z.int().positive(),
  headline: z.string(),
  sections: z.array(z.object({ id: z.enum(["compared", "score", "pick", "limit", "considerations"]), title: z.string(), lines: z.array(z.string()) })),
  costLines: z.array(z.object({ label: z.string(), detail: z.string().nullable(), value: z.string(), total: z.boolean() })),
  ranking: z.array(z.object({ quantity: z.int().positive(), perPart: z.string(), vsPick: z.string(), picked: z.boolean() })),
});

/** One shortlisted quantity, designed in full. Best first; rank 1 is the recommendation. */
export const RankedConfigurationSchema = z.object({
  rank: z.int().min(1),
  quantityPerCrate: z.int().positive(),
  layoutKey: z.string().min(1),
  /** The engine's `inputHash` of this exact design (part, settings, standards, layout). */
  inputHash: hash,
  settings: CrateSettingsSchema,
  /** (crate cost + freight) ÷ parts; crate cost ÷ parts when no freight rates were given. */
  scoreUsdPerPart: z.number(),
  crateCostUsd: z.number(),
  /** One crate's freight, or null without rates. */
  freightUsd: z.number().nullable(),
  freightClass: z.number(),
  densityLbFt3: z.number(),
  grossKg: z.number(),
  tareKg: z.number().nullable(),
  outsideMm: Vec3Schema.nullable(),
  screws: z.int().nullable(),
  /**
   * Crates the full design (`designShipment` at this quantity) uses. 1 almost always; more when
   * the shipment planner's per-crate gross limit (from the base rating) is stricter than the
   * sweep's hard checks and it splits the batch (a known gap, docs/QUEUE.md).
   */
  crates: z.int().positive(),
});
export type RankedConfiguration = z.infer<typeof RankedConfigurationSchema>;

export const DesignsResponseSchema = z.object({
  engineVersion: z.string().min(1),
  /** Hash of the sweep's inputs (part, rules, standards, rates, total). */
  inputHash: hash,
  part: z.object({ name: z.string(), massKg: z.number().positive(), sizeMm: Vec3Schema }),
  basis: z.enum(["crate-and-freight", "crate-only"]),
  maxQuantity: z.int().positive(),
  recommendation: z
    .object({
      quantityPerCrate: z.int().positive(),
      /** One or two plain sentences: why this quantity, and what stopped a larger crate. */
      rationale: z.string(),
      stoppedBy: z.object({ quantity: z.int().positive(), binding: z.enum(SWEEP_CONSTRAINTS), reason: z.string() }).nullable(),
      costLimited: z.boolean(),
      /** "Why this crate?" as the Rules tab says it, in metric (spec §7.16 "Explaining the recommendation"). */
      explanation: ExplanationSchema,
    })
    .nullable(),
  configurations: z.array(RankedConfigurationSchema),
  /** With `total`: how the parts ship, split evenly. Null without a total or when no split passes. */
  total: z
    .object({
      total: z.int().positive(),
      crates: z.int().positive(),
      perCrate: z.int().positive(),
      types: z.array(z.object({ label: z.string(), count: z.int().positive(), quantity: z.int().positive(), layoutKey: z.string() })),
      crateCostUsd: z.number(),
      freightUsd: z.number().nullable(),
      scoreUsdPerPart: z.number(),
    })
    .nullable(),
  /** Every quantity tried: passing ones carry their score, failing ones the rule that stopped them. */
  curve: z.array(
    z.object({
      quantity: z.int().positive(),
      ok: z.boolean(),
      binding: z.enum(SWEEP_CONSTRAINTS).nullable(),
      scoreUsdPerPart: z.number().nullable(),
    }),
  ),
  problem: z.object({ id: z.string(), title: z.string(), detail: z.string() }).nullable(),
});
export type DesignsResponse = z.infer<typeof DesignsResponseSchema>;

/** What the API adds about the uploaded file (the engine never sees it). */
export const DesignsApiResponseSchema = DesignsResponseSchema.extend({
  model: z.object({ sha256: hash, sizeBytes: z.int().positive(), readAsMm: z.boolean() }),
});
export type DesignsApiResponse = z.infer<typeof DesignsApiResponseSchema>;
