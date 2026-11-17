/**
 * Request and response shapes for `/api/v1/parts` (#46). Pure Zod, so the server validates with
 * them and a browser or script client can parse responses with the same schemas.
 *
 * POST /api/v1/parts   multipart/form-data:
 *   file      the part's binary .glb (no Draco / Meshopt, at most MAX_GLB_BYTES)
 *   mass      kg per part, required (spec §6.1: never inferred from the mesh); "12.5" or "12.5 kg"
 *   material  optional text
 *   density   optional kg/m³
 *   name      optional; defaults to one made from the file name
 *   units     optional: what the file's numbers are in, m | mm | in (spec §4); guessed from its size when absent
 *   up        optional: which axis of the file points up, z | y; z when absent
 * GET /api/v1/parts/:id/model   a ~5 min presigned GET URL for the part's GLB (`?redirect=1`: 302 to it)
 */
import { z } from "zod";
import { MODEL_UNITS, UP_AXES } from "@/domain/partFrame";
import { Vec3Schema } from "@/domain/schema";
import { parseMass } from "../partFields";

/** A form field as text: missing → "", trimmed. */
const field = z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string());

const optionalText = (label: string, max: number) =>
  field.pipe(z.string().max(max, `${label} can be at most ${max} characters.`)).transform((v) => v || undefined);

/** The text fields of a part upload, as the form sends them (strings, or absent). */
export const CreatePartFieldsSchema = z.object({
  mass: field.transform((text, ctx) => {
    // The API takes kg only: refuse a pound value rather than reading "30 lb" as 30 kg.
    const parsed = /lbs?\.?$/i.test(text) ? parseMass("x", "metric") : parseMass(text, "metric");
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.kg;
  }),
  material: optionalText("Material", 120),
  density: field.transform((text, ctx) => {
    if (text === "") return undefined;
    const value = Number(text.replace(/\s*kg\/m(3|³)$/i, "").replace(",", "."));
    if (!Number.isFinite(value)) {
      ctx.addIssue({ code: "custom", message: "Enter a density in kg/m³, like 7850." });
      return z.NEVER;
    }
    if (!(value > 0)) {
      ctx.addIssue({ code: "custom", message: "Density must be more than 0 kg/m³." });
      return z.NEVER;
    }
    return value;
  }),
  name: optionalText("Name", 200),
  units: field.pipe(z.enum(["", ...MODEL_UNITS], { error: "Units must be m, mm or in." })).transform((v) => v || undefined),
  up: field.pipe(z.enum(["", ...UP_AXES], { error: "Up must be z or y." })).transform((v) => v || undefined),
});
export type CreatePartFields = z.infer<typeof CreatePartFieldsSchema>;

export const PartResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  material: z.string().nullable(),
  densityKgM3: z.number().nullable(),
  massKg: z.number().positive(),
  /** Bounding box of the model in mm, [x, y, z], Z up, measured by the server in the part's frame. */
  sizeMm: Vec3Schema,
  /** How the model is read (spec §4): its units and up axis. Null for a part with no model, or one uploaded before they were recorded. */
  units: z.enum(MODEL_UNITS).nullable().optional(),
  up: z.enum(UP_AXES).nullable().optional(),
  modelSha256: z.string().nullable(),
  source: z.enum(["catalog", "upload"]),
  /** The catalog entry a `catalog` part was registered from; null for uploads. */
  catalogId: z.string().nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type PartResponse = z.infer<typeof PartResponseSchema>;

export const CreatePartResponseSchema = z.object({
  part: PartResponseSchema,
  model: z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().positive(),
    /** The file was read as millimetres (`units` is "mm"). Kept for older clients. */
    readAsMm: z.boolean(),
    /** What the file's numbers were read as, and which axis was taken as up (spec §4). */
    units: z.enum(MODEL_UNITS),
    up: z.enum(UP_AXES),
    /** True when `units` was guessed from the model's size (no `units` field was sent). */
    unitsGuessed: z.boolean(),
    /** False when this org already had the same file: no second copy was stored. */
    created: z.boolean(),
  }),
});
export type CreatePartResponse = z.infer<typeof CreatePartResponseSchema>;

export const ModelUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
  sha256: z.string(),
  sizeBytes: z.number().int().positive(),
});
export type ModelUrlResponse = z.infer<typeof ModelUrlResponseSchema>;

const API_ERROR_CODES = [
  "invalid_request",
  "unsupported_file",
  "invalid_glb",
  "too_large",
  "not_found",
  "internal",
  /** 401: no API key, or one that is unknown or revoked (src/server/auth.ts, docs/QUEUE.md). */
  "unauthorized",
  /** 503: the engine worker pool isn't available on this server. */
  "unavailable",
  // Jobs and configurations (src/lib/api/jobs.ts, docs/API.md):
  /** 409: the save was made by another engine; the client reloads to get the server's. */
  "engine_version_mismatch",
  /** 422: the server recomputed the configuration and got a different inputHash or result. */
  "result_mismatch",
  /** 409: the job changed since the client read it; the body carries the current job. */
  "version_conflict",
  /** 422: an Idempotency-Key reused with a different request. */
  "idempotency_conflict",
] as const;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    /** One plain sentence for the user, the same words the app shows. */
    message: z.string(),
    /** The form field it is about, when there is one. */
    field: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = ApiError["error"]["code"];
