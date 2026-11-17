import { z } from "zod";
import { version } from "../../package.json";
import type { CrateDesign } from "./crate";
import { computeDesign } from "./design";
import { CrateSettingsSchema, Vec3Schema, type CrateSettings, type DesignPart, type Vec3 } from "./schema";

/**
 * The saved design file (#28, spec §6.4): a versioned, zod-validated JSON document that
 * holds everything needed to rebuild a crate: the part, the packing rules and the layout.
 * The summary is for people reading the file and for checking that the crate comes out the
 * same when it is opened again. Pure: no DOM, no I/O.
 */

export const DESIGN_FILE_KIND = "crate-design";
/** Bump when the format changes in a way older readers can't handle, and add a migration. */
export const DESIGN_SCHEMA_VERSION = 1;
export const APP_NAME = "crate-designer";
export const APP_VERSION: string = version;

export const DesignFilePartSchema = z.object({
  /** "catalog": the model ships with the app (/public/parts). "custom": the user supplies the GLB. */
  source: z.enum(["catalog", "custom"]),
  id: z.string().min(1),
  name: z.string().min(1),
  material: z.string().optional(),
  mass_kg: z.number().positive(),
  /** True when the mass is the 10 kg stand-in, not a real value. */
  massAssumed: z.boolean().optional(),
  /** Bounding box in mm, model frame, as measured or from the catalog. */
  dimensions_mm: Vec3Schema,
  /** The GLB's file name. */
  model: z.string().endsWith(".glb"),
});
export type DesignFilePart = z.infer<typeof DesignFilePartSchema>;

export const DesignFileSchema = z.object({
  kind: z.literal(DESIGN_FILE_KIND),
  schemaVersion: z.literal(DESIGN_SCHEMA_VERSION),
  app: z.object({ name: z.string(), version: z.string() }),
  savedAt: z.string(),
  part: DesignFilePartSchema,
  settings: CrateSettingsSchema,
  /** Key of the layout on screen when saved (`Layout.key`). */
  layoutKey: z.string().min(1),
  summary: z.object({
    quantity: z.number().int().positive(),
    /** "2 × 2 × 1, As modeled": counts along X × Y × Z and the orientation. */
    layout: z.string(),
    /** Outside size, rounded mm. */
    outsideMm: Vec3Schema,
    /** Gross weight, kg, one decimal. */
    grossKg: z.number().positive(),
  }),
});
export type DesignFile = z.infer<typeof DesignFileSchema>;

export interface SerializeInput {
  part: DesignFilePart;
  settings: CrateSettings;
  layoutKey: string;
  design: CrateDesign;
  /** ISO timestamp; passed in so this stays pure. */
  savedAt: string;
}

/** The design as pretty-printed JSON, ending in a newline. */
export function serializeDesign({ part, settings, layoutKey, design, savedAt }: SerializeInput): string {
  const file: DesignFile = {
    kind: DESIGN_FILE_KIND,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    savedAt,
    part: DesignFilePartSchema.parse(part),
    settings: CrateSettingsSchema.parse(settings),
    layoutKey,
    summary: summarize(design),
  };
  return JSON.stringify(file, null, 2) + "\n";
}

function summarize(design: CrateDesign): DesignFile["summary"] {
  const { layout } = design;
  return {
    quantity: layout.slots.length,
    layout: `${layout.counts.join(" × ")}, ${layout.orientation.label}`,
    outsideMm: layout.external.map(Math.round) as Vec3,
    grossKg: Math.round(design.grossKg * 10) / 10,
  };
}

/** True for JSON that claims to be a design file (by `kind`), as opposed to a parts.json catalog. */
export function isDesignFileJson(json: unknown): boolean {
  return typeof json === "object" && json !== null && !Array.isArray(json) && (json as { kind?: unknown }).kind === DESIGN_FILE_KIND;
}

export type ParseResult = { ok: true; file: DesignFile } | { ok: false; error: string };

/**
 * Migrations from older versions, keyed by the version they read. Each returns the next
 * version's shape. Empty while there is only version 1.
 */
const MIGRATIONS: Record<number, (json: Record<string, unknown>) => Record<string, unknown>> = {};

/** Reads a design file: JSON → version check → migrate → zod. Never throws. */
export function parseDesignFile(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This design file is not valid JSON." };
  }
  if (!isDesignFileJson(json)) return { ok: false, error: "This file is not a crate design." };
  let doc = json as Record<string, unknown>;
  let v = doc.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    return { ok: false, error: "This design file has no valid schemaVersion." };
  }
  if (v > DESIGN_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This design was saved by a newer version of the app (format ${v}; this app reads up to ${DESIGN_SCHEMA_VERSION}). Update the app to open it.`,
    };
  }
  while (v < DESIGN_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return { ok: false, error: `Design format ${v} can no longer be read.` };
    doc = { ...migrate(doc), schemaVersion: v + 1 };
    v += 1;
  }
  const r = DesignFileSchema.safeParse(doc);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: `This design file can't be read: ${issue.path.join(".") || "file"}: ${issue.message}.` };
  }
  return { ok: true, file: r.data };
}

export interface RestoredDesign {
  settings: CrateSettings;
  /** The saved layout's key, or null (the recommended layout) when it no longer exists. */
  layoutKey: string | null;
  /** Plain sentences on anything that came out differently from the saved design. */
  notes: string[];
}

/**
 * Rebuilds a saved design for `part` (the catalog entry or the reloaded model) and checks it
 * against the saved summary. The saved layout is kept if it still exists; otherwise the
 * recommended one is used and a note says so.
 */
export function restoreDesign(file: DesignFile, part: DesignPart): RestoredDesign {
  const { settings } = file;
  const notes: string[] = [];
  const result = computeDesign(part, settings, file.layoutKey);
  const found = result.layouts.some((l) => l.key === file.layoutKey);
  if (!found) notes.push(`The saved layout (${file.summary.layout}) no longer fits, so the recommended layout is shown.`);
  const design = result.design;
  if (design) {
    const now = summarize(design);
    const mm = (v: Vec3) => `${v.join(" × ")} mm`;
    if (now.outsideMm.some((v, i) => v !== file.summary.outsideMm[i])) {
      notes.push(`The crate is now ${mm(now.outsideMm)} outside (saved: ${mm(file.summary.outsideMm)}).`);
    }
    if (Math.abs(now.grossKg - file.summary.grossKg) > 0.1) {
      notes.push(`Gross is now ${now.grossKg} kg (saved: ${file.summary.grossKg} kg).`);
    }
  }
  return { settings, layoutKey: found ? file.layoutKey : null, notes };
}
