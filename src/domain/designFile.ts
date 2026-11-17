import { z } from "zod";
import type { CrateDesign } from "./crate";
import { RANKINGS, type Ranking } from "./design";
import { cogInsideBox, PartCogSchema } from "./cog";
import { hasKind, readEnvelope, writeEnvelope } from "./envelope";
import { kg, mm, msg, type Message } from "./message";
import { MODEL_UNITS, UP_AXES } from "./partFrame";
import { usableProfile, type PartProfile } from "./profile";
import { decodeProfile, EncodedProfileSchema } from "./profileCodec";
import { CrateSettingsSchema, Vec3Schema, type CrateSettings, type DesignPart, type Vec3 } from "./schema";
import { describeShipment, planShipment, type ShipmentPlan } from "./shipment";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/**
 * The saved design file (spec §6.4): a versioned, zod-validated JSON document that holds
 * everything needed to rebuild the same crate: the part (with its measured outline, which
 * shaped blocking depends on), the packing rules, the ranking and the layout. The summary is
 * for people reading the file and for checking that the crate comes out the same when it is
 * opened again. Pure: no DOM, no I/O, no package metadata (the caller passes `app` and `savedAt`).
 */

export const DESIGN_FILE_KIND = "crate-design";
/**
 * Bump when the format changes in a way older readers can't handle, and add a migration.
 * 2: the layout ranking and the part's measured outline joined the file, because the crate
 * planned from a file depends on both.
 * 3: the part's file units and up axis joined the file, because the model is measured with them.
 */
export const DESIGN_SCHEMA_VERSION = 3;

const DesignFilePartSchema = z.object({
  /** "catalog": the model ships with the app (/public/parts). "custom": the user supplies the GLB. */
  source: z.enum(["catalog", "custom"]),
  id: z.string().min(1),
  name: z.string().min(1),
  material: z.string().optional(),
  mass_kg: z.number().positive(),
  /** True when the mass is the 10 kg stand-in, not a real value. */
  massAssumed: z.boolean().optional(),
  /** Bounding box in mm, Z up, as measured (with the units and axis below) or from the catalog. */
  dimensions_mm: Vec3Schema,
  /**
   * What the GLB's numbers are in. Absent only in a custom part migrated from before format 3,
   * which was read as metres or millimetres by a size guess: the reader then takes the units
   * that give `dimensions_mm` again.
   */
  units: z.enum(MODEL_UNITS).optional(),
  /** Which axis of the GLB points up. Absent means Z up: files from before format 3 were all read that way. */
  up: z.enum(UP_AXES).optional(),
  /** True when the units are the app's guess from the model's size, not a choice. */
  unitsGuessed: z.literal(true).optional(),
  /** The GLB's file name. */
  model: z.string().endsWith(".glb"),
  /**
   * The part's measured outline (spec §7.5b), packed (`profileCodec`). Absent when the model
   * had not been measured when the file was saved, and in files from before format 2.
   */
  outline: EncodedProfileSchema.refine((p) => decodeProfile(p) !== null, "the part outline is damaged").optional(),
  /**
   * The part's own centre of gravity (spec §7.14, #110): an offset from the middle of the bounding box,
   * mm, Z up, and who gave it. Absent when there was none: the file then opens with the mesh estimate,
   * or the box centre. An optional field, so format 3 files without it stay valid and older readers ignore it.
   */
  cog: PartCogSchema.optional(),
});
export type DesignFilePart = z.infer<typeof DesignFilePartSchema>;

const DesignFileSchema = z.object({
  kind: z.literal(DESIGN_FILE_KIND),
  schemaVersion: z.literal(DESIGN_SCHEMA_VERSION),
  app: z.object({ name: z.string(), version: z.string() }),
  savedAt: z.string(),
  /**
   * The engine that made the file and the hash of its input (spec §5.1): written by the engine's
   * file builders (the Export package), absent from a file saved with Download design (.json).
   */
  engine: z.object({ version: z.string(), inputHash: z.string() }).optional(),
  part: DesignFilePartSchema,
  settings: CrateSettingsSchema,
  /** How the recommended layout was chosen (spec §7.2); the layout lists and the "why" follow it. */
  ranking: z.enum(RANKINGS),
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
    /**
     * Only for a batch split across crates: each crate type's count and parts per
     * crate. The rest of the summary then describes the crate type that was on screen.
     */
    shipment: z
      .array(z.object({ count: z.number().int().positive(), quantity: z.number().int().positive() }))
      .min(1)
      .optional(),
    /**
     * Set by the 1 to 2 migration: the file was written before part outlines were kept, so
     * the summary may include shaped blocking that the file cannot reproduce on its own.
     */
    shapeUnknown: z.literal(true).optional(),
  }),
});
export type DesignFile = z.infer<typeof DesignFileSchema>;

export interface SerializeInput {
  part: DesignFilePart;
  settings: CrateSettings;
  layoutKey: string;
  /** Defaults to the volume ranking. */
  ranking?: Ranking;
  design: CrateDesign;
  /** The shipment plan the design belongs to; a split is recorded in the summary. */
  plan?: ShipmentPlan;
  /** Who wrote the file; passed in so the domain does not read package metadata. */
  app: { name: string; version: string };
  /** ISO timestamp; passed in so this stays pure. */
  savedAt: string;
  /** The engine's stamp, when the engine built the file. */
  engine?: { version: string; inputHash: string };
}

/** The design as pretty-printed JSON, ending in a newline. */
export function serializeDesign({ part, settings, layoutKey, ranking = "volume", design, plan, app, savedAt, engine }: SerializeInput): string {
  const file: DesignFile = {
    kind: DESIGN_FILE_KIND,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    app: { name: app.name, version: app.version },
    savedAt,
    ...(engine ? { engine: { version: engine.version, inputHash: engine.inputHash } } : {}),
    part: DesignFilePartSchema.parse(part),
    settings: CrateSettingsSchema.parse(settings),
    ranking,
    layoutKey,
    summary: {
      ...summarize(design),
      ...(plan?.split ? { shipment: plan.crates.map((c) => ({ count: c.count, quantity: c.quantity })) } : {}),
    },
  };
  return writeEnvelope(file);
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
  return hasKind(json, DESIGN_FILE_KIND);
}

export type ParseResult = { ok: true; file: DesignFile } | { ok: false; error: string };

const FORMAT = {
  kind: DESIGN_FILE_KIND,
  version: DESIGN_SCHEMA_VERSION,
  label: "design file",
  what: "a crate design",
  versionKey: "schemaVersion",
  migrations: {
    // 1 to 2: files from before the ranking was recorded were all ranked by volume.
    // The summary may have counted shaped blocks the file has no outline for.
    1: (doc: Record<string, unknown>) => ({
      ...doc,
      ranking: "volume",
      summary: typeof doc.summary === "object" && doc.summary !== null ? { ...doc.summary, shapeUnknown: true } : doc.summary,
    }),
    // 2 to 3: every earlier file was read Z up. A catalog part is a metre file; a custom part's
    // units were a guess that the file does not record, so they stay absent (see `units` above).
    2: (doc: Record<string, unknown>) => {
      const part = typeof doc.part === "object" && doc.part !== null ? (doc.part as Record<string, unknown>) : null;
      return part ? { ...doc, part: { ...part, up: "z", ...(part.source === "catalog" ? { units: "m" } : {}) } } : doc;
    },
  },
};

/** Reads a design file: JSON, version check, migrations, then zod. Never throws. */
export function parseDesignFile(text: string): ParseResult {
  const read = readEnvelope(text, FORMAT);
  if (!read.ok) return read;
  const r = DesignFileSchema.safeParse(read.doc);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: `This design file can't be read: ${issue.path.join(".") || "file"}: ${issue.message}.` };
  }
  return { ok: true, file: r.data };
}

/** The part outline a file carries, or undefined. */
export function fileProfile(file: DesignFile): PartProfile | undefined {
  return file.part.outline ? (decodeProfile(file.part.outline) ?? undefined) : undefined;
}

export interface RestoredDesign {
  settings: CrateSettings;
  /** The saved layout's key, or null (the recommended layout) when it no longer exists. */
  layoutKey: string | null;
  /** The ranking the design was saved with. */
  ranking: Ranking;
  /** Anything that came out differently from the saved design; its numbers stay data until shown in the selected units. */
  notes: Message[];
  /** Which crate type of a split batch to show (0 for a single crate). */
  crateIndex: number;
}

const sizeMessage = (v: Vec3): Message => msg`${mm(v[0])} × ${mm(v[1])} × ${mm(v[2])}`;

/**
 * Rebuilds a saved design for `part` (the catalog entry or the reloaded model) and checks it
 * against the saved summary. The part's outline and the ranking come from the file, so the
 * crate is the one that was saved. The saved layout is kept if it still exists; otherwise the
 * recommended one is used and a note says so.
 */
export function restoreDesign(file: DesignFile, part: DesignPart, standards: ShopStandards = DEFAULT_STANDARDS): RestoredDesign {
  const { settings } = file;
  const notes: Message[] = [];
  const saved = fileProfile(file);
  const withOutline: DesignPart = part.profile || !saved ? part : { ...part, profile: saved };
  // The saved centre of gravity too, for a part the caller didn't already give one.
  const savedCog = file.part.cog;
  const shaped: DesignPart =
    withOutline.cog || !savedCog || !cogInsideBox(savedCog.offsetMm, part.dimensions_mm) ? withOutline : { ...withOutline, cog: savedCog };
  const plan = planShipment(shaped, settings, file.layoutKey, standards, file.ranking);
  // The summary describes the crate type that was on screen: find it by its part count.
  const crateIndex = Math.max(
    0,
    plan.crates.findIndex((c) => c.quantity === file.summary.quantity),
  );
  const result = plan.crates[crateIndex].result;
  const found = result.layouts.some((l) => l.key === file.layoutKey);
  if (!found) notes.push([`The saved layout (${file.summary.layout}) no longer fits, so the recommended one is shown.`]);
  const was = file.summary.shipment ?? [{ count: 1, quantity: settings.quantity }];
  const same = was.length === plan.crates.length && was.every((c, i) => c.count === plan.crates[i].count && c.quantity === plan.crates[i].quantity);
  if (!same) {
    const text = describeShipment({ crates: was.map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) })) });
    notes.push([`The batch now ships as ${describeShipment(plan)} (was ${text}).`]);
  }
  const design = result.design;
  if (design && same) {
    const now = summarize(design);
    const sizeDiffers = now.outsideMm.some((v, i) => v !== file.summary.outsideMm[i]);
    const grossDiffers = Math.abs(now.grossKg - file.summary.grossKg) > 0.1;
    // An older file does not carry the part's shape. Blocking then follows the bounding box until
    // the viewer measures the model (every loaded part has one), which moves the totals to the
    // saved ones: saying so now would only be noise.
    const settling = file.summary.shapeUnknown && !usableProfile(shaped);
    if (!settling) {
      if (sizeDiffers) notes.push(msg`The crate is now ${sizeMessage(now.outsideMm)} outside (was ${sizeMessage(file.summary.outsideMm)}).`);
      if (grossDiffers) notes.push(msg`Gross is now ${kg(now.grossKg)} (was ${kg(file.summary.grossKg)}).`);
    }
  }
  return { settings, layoutKey: found ? file.layoutKey : null, ranking: file.ranking, notes, crateIndex };
}
