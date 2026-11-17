import { z } from "zod";
import { RANKINGS } from "@/domain/design";
import { FACE_IDS } from "@/domain/profile";
import { CrateSettingsSchema, PartSchema, Vec3Schema } from "@/domain/schema";
import type { ShipmentPlan } from "@/domain/shipment";
import { ShopStandardsSchema } from "@/domain/standards";
import type { SweepRequest, SweepResponse } from "./sweep";

/**
 * Requests and responses of the engine's calls (spec §5.1), shared by every caller: the
 * browser's worker client, the server's Route Handlers and the CLI validate the same types.
 * The browser calls the engine with values it already holds typed, so its hot path doesn't
 * parse; anything that arrives over the wire is parsed with these first.
 */

const FaceDepthSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  depth: z.array(z.number()),
});

/** `PartProfile` (spec §7.5b): the part's measured outline, a depth grid per bounding-box face. */
export const PartProfileSchema = z.object({
  version: z.literal(1),
  sizeMm: Vec3Schema,
  cellMm: z.number().positive(),
  faces: z.object(Object.fromEntries(FACE_IDS.map((f) => [f, FaceDepthSchema])) as Record<(typeof FACE_IDS)[number], typeof FaceDepthSchema>),
});

/** `DesignPart`: what the engine needs to know about a part. A catalog part or a loaded GLB's facts. */
export const DesignPartSchema = PartSchema.pick({ id: true, name: true, mass_kg: true, dimensions_mm: true }).extend({
  material: z.string().optional(),
  profile: PartProfileSchema.optional(),
  /** The quantities the part is usually shipped in (#133); the sweep recommends among them. */
  suggested_quantities: z.array(z.int().positive()).optional(),
});

export const RankingSchema = z.enum(RANKINGS);
export const UnitsSchema = z.enum(["imperial", "metric"]);

/**
 * One design: a part, its packing rules (`settings.quantity` is the batch), the shop standards,
 * an optional layout pick and the ranking. `planShipment` runs on exactly these.
 */
export const DesignRequestSchema = z.object({
  part: DesignPartSchema,
  settings: CrateSettingsSchema,
  standards: ShopStandardsSchema,
  layoutKey: z.string().nullable(),
  ranking: RankingSchema,
});
export type DesignRequest = z.infer<typeof DesignRequestSchema>;

/** What every engine output carries (spec §5.1). */
export const EngineStampSchema = z.object({
  /** `ENGINE_VERSION`: package version plus engine revision ("0.1.0+engine.5"). */
  engineVersion: z.string().min(1),
  /** SHA-256 (hex) of the canonical request: `inputHash()`. */
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EngineStamp = z.infer<typeof EngineStampSchema>;

const CrateSummarySchema = z.object({
  label: z.string(),
  count: z.number().int().positive(),
  quantity: z.number().int().positive(),
  layoutKey: z.string().nullable(),
  outsideMm: Vec3Schema.nullable(),
  grossKg: z.number().nullable(),
  tareKg: z.number().nullable(),
  screws: z.number().int().nullable(),
  costUsd: z.number().nullable(),
});

/** The numbers a person or a script compares designs by, without the boards. */
export const DesignSummarySchema = z.object({
  quantity: z.number().int().positive(),
  split: z.boolean(),
  crates: z.array(CrateSummarySchema),
  totals: z.object({
    crates: z.number().int(),
    parts: z.number().int(),
    grossKg: z.number(),
    tareKg: z.number(),
    volumeM3: z.number(),
    costUsd: z.number(),
  }),
  problem: z.object({ id: z.string(), title: z.string(), detail: z.string() }).nullable(),
});
export type DesignSummary = z.infer<typeof DesignSummarySchema>;

/**
 * `designShipment`'s answer. `plan` is the full `ShipmentPlan` (boards, cut list, checks); it is
 * only checked to be an object here, since the engine made it. Callers outside the engine
 * should rely on `summary`, which is validated in full.
 */
export const DesignResponseSchema = EngineStampSchema.extend({
  summary: DesignSummarySchema,
  plan: z.custom<ShipmentPlan>((v) => typeof v === "object" && v !== null && Array.isArray((v as ShipmentPlan).crates)),
});
export type DesignResponse = z.infer<typeof DesignResponseSchema>;

/** A cut list: the crate type on screen (`crateIndex`) or, for a split batch, the whole shipment. */
export const CutListRequestSchema = DesignRequestSchema.extend({
  units: UnitsSchema,
  scope: z.enum(["crate", "shipment"]),
  crateIndex: z.number().int().min(0),
});
export type CutListRequest = z.infer<typeof CutListRequestSchema>;

export const CutListResponseSchema = EngineStampSchema.extend({
  fileName: z.string().min(1),
  csv: z.string(),
});
export type CutListResponse = z.infer<typeof CutListResponseSchema>;

/** The calls the browser's engine worker runs: request and response per op. */
export interface WorkerOps {
  design: { request: DesignRequest; output: DesignResponse };
  sweep: { request: SweepRequest; output: SweepResponse };
}
export type WorkerOp = keyof WorkerOps;

/** Messages between the browser's engine client and its Web Worker (`src/state/engine.worker.ts`). */
export type WorkerRequest = { [K in WorkerOp]: { id: number; op: K; request: WorkerOps[K]["request"] } }[WorkerOp];
export type WorkerResponse = { id: number; ok: true; output: WorkerOps[WorkerOp]["output"] } | { id: number; ok: false; error: string };
