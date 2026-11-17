import { catalog } from "@/domain/catalog";
import { fileProfile, parseDesignFile, restoreDesign, type DesignFile, type DesignFilePart } from "@/domain/designFile";
import type { Ranking } from "@/domain/design";
import type { Message } from "@/domain/message";
import { usableProfile, type PartProfile } from "@/domain/profile";
import { encodeProfile } from "@/domain/profileCodec";
import type { CatalogEntry, CrateSettings, Part, Vec3 } from "@/domain/schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "@/domain/standards";
import { checkFiles, type FileInput } from "./fileCheck";
import { reportFor, verdict, type FileReport } from "./fileCheckReport";
import { catalogPart, framePart, type LoadedPart } from "./part";
import { fitFrame, framedSizeMm, guessUnits, type PartFrame } from "./partFrame";
import { renderMessage } from "./message";
import type { Units } from "./units";

/** Mass used for an unknown part until the user enters one. Never inferred from the mesh (spec §6.1). */
const STAND_IN_MASS_KG = 10;
const DEFAULT_QUANTITIES = [1, 4, 8];

/** The part id a file name gives: the name without ".glb"; "part" for a file that is only ".glb". */
export function idFromFile(fileName: string): string {
  return fileName.replace(/\.glb$/i, "").trim() || "part";
}

/** "PART-004-cast-iron-cover.glb" → "Cast iron cover"; a file called only ".glb" is "Part". */
export function nameFromFile(fileName: string): string {
  const stem = idFromFile(fileName);
  const words =
    stem
      .replace(/^PART-\d+-/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || stem;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface ReadGlb {
  url: string;
  /** The model's size as the file has it (file units, file axes). */
  raw: Vec3;
}

/** The frame a file is first read in when nothing says otherwise: Z up, units guessed from its size (spec §4). */
const guessedFrame = (raw: Vec3): PartFrame => ({ units: guessUnits(Math.max(...raw)), up: "z" });

/** Checks and measures one GLB (the file check's rules), then makes an object URL for it. A string is a problem message. */
async function readGlb(glb: File): Promise<ReadGlb | string> {
  const buffer = await glb.arrayBuffer();
  const check = checkFiles([{ name: glb.name, content: buffer }]);
  const error = check.findings.find((f) => f.severity === "error");
  if (error || !check.opened) return error ? renderMessage(error.message, "metric") : "That .glb file can't be read. Try exporting it again.";
  return { url: URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" })), raw: check.opened.raw };
}

export interface LoadOutcome {
  part?: LoadedPart;
  /** Settings and layout to restore with `part`, when a design file was loaded. */
  design?: { settings: CrateSettings; layoutKey: string | null; crateIndex: number; ranking: Ranking };
  /** The parts.json entries that passed the file check: they join the catalog even when no .glb opened. */
  catalogAdditions: CatalogEntry[];
  /** The load toast's one line: empty for a clean load. */
  message: string;
  /** What the file check found, for the File check report; null when it found nothing. */
  report?: FileReport | null;
}

/** The part for a .glb that an entry names: the entry's details, in the frame the check chose. */
function entryPart(entry: CatalogEntry, url: string, raw: Vec3, frame: PartFrame, guessed: boolean): LoadedPart {
  const dims = entry.dimensions_mm;
  const framed = framePart(
    {
      id: entry.id,
      name: entry.name,
      model: entry.model,
      ...(entry.material !== undefined ? { material: entry.material } : {}),
      mass_kg: entry.mass_kg,
      dimensions_mm: framedSizeMm(raw, frame),
      suggested_quantities: entry.suggested_quantities ?? DEFAULT_QUANTITIES,
      modelUrl: url,
      modelUnits: frame.units,
      upAxis: frame.up,
      unitsGuessed: guessed,
      mmPerUnit: 1,
      rawSize: raw,
      ...(dims ? { catalogDims: dims } : {}),
      massAssumed: false,
    },
    frame,
    guessed,
  );
  // An entry with a size designs the crate on that size; the model check says when the file differs.
  return dims ? { ...framed, dimensions_mm: dims } : framed;
}

/**
 * Turns dropped or picked files into a part. `units` is how any note on a design is worded. A JSON file is either a saved design (by its
 * `kind`, spec §6.4) or a parts.json catalog. Every decision comes from the file check (`checkFiles`, spec §6.6), which is also what
 * the File check report shows, so the two cannot disagree.
 * - A design restores its part, rules and layout (`loadDesign`).
 * - Otherwise a parts.json adds its accepted entries, and the .glb an entry names (else the first one) opens as the part with that
 *   entry's mass, material and quantities. Anything else gets a stand-in mass. One part at a time: other .glb files are not opened.
 */
export async function loadPartFiles(
  files: File[],
  known: CatalogEntry[],
  bundled: Part[] = catalog.parts,
  /** The shop standards a saved design is rebuilt with (and its shipment re-planned). */
  standards: ShopStandards = DEFAULT_STANDARDS,
  units: Units = "metric",
): Promise<LoadOutcome> {
  const inputs: FileInput[] = [];
  for (const f of files) {
    const kind = /\.([^./\\]+)$/.exec(f.name)?.[1].toLowerCase();
    inputs.push({ name: f.name, content: kind === "json" ? await f.text() : kind === "glb" ? await f.arrayBuffer() : "" });
  }
  const check = checkFiles(inputs, { known });
  const catalogAdditions = check.entries;
  const said = verdict(check);

  if (check.design) {
    const parsed = parseDesignFile(check.design.text);
    if (!parsed.ok) return { catalogAdditions, message: parsed.error, report: reportFor(check, false) };
    const out = await loadDesign(
      parsed.file,
      files.filter((f) => /\.glb$/i.test(f.name)),
      bundled,
      standards,
      units,
    );
    return { catalogAdditions, ...out, message: [out.message, said].filter(Boolean).join(" "), report: reportFor(check, Boolean(out.part)) };
  }

  const opened = check.opened;
  if (!opened) {
    // Only details so far: the part is chosen next. Findings (an entry skipped, say) still show.
    const message = check.awaitingGlb ? ["Part details loaded. Now choose its .glb file.", said].filter(Boolean).join(" ") : said;
    return {
      catalogAdditions,
      message: message || "Nothing could be loaded. Choose a .glb part, with a parts.json if you have one, or a saved design .json.",
      report: reportFor(check, false),
    };
  }

  const index = files.findIndex((f) => f.name === opened.name);
  const url = URL.createObjectURL(new Blob([inputs[index].content as ArrayBuffer], { type: "model/gltf-binary" }));
  const { raw, frame, guessed, entry } = opened;
  const report = reportFor(check, true);
  if (entry) return { catalogAdditions, message: said, report, part: entryPart(entry, url, raw, frame, guessed) };
  return {
    catalogAdditions,
    message: said,
    report,
    part: framePart(
      {
        id: idFromFile(opened.name),
        name: nameFromFile(opened.name),
        model: opened.name,
        mass_kg: STAND_IN_MASS_KG,
        dimensions_mm: framedSizeMm(raw, frame),
        suggested_quantities: DEFAULT_QUANTITIES,
        modelUrl: url,
        modelUnits: frame.units,
        upAxis: frame.up,
        unitsGuessed: guessed,
        mmPerUnit: 1,
        rawSize: raw,
        massAssumed: true,
      },
      frame,
      guessed,
    ),
  };
}

/**
 * A measured size this close (mm, per axis) to the saved one is the same model: the saved size
 * is kept, so the crate matches the file exactly. Tighter than the 1 mm that `lumber.ts` allows
 * between a nominal lumber size and its rounded millimetres: this compares two measurements of
 * one model (float noise only), that one compares a name with a rounded size.
 */
const SAME_MODEL_SIZE_MM = 0.5;

/**
 * A saved design → part, settings and layout (spec §6.4).
 * - A catalog part comes from the bundled catalog and /public/parts.
 * - A custom part (or a catalog id this app doesn't have) needs its GLB, picked or dropped
 *   together with the design file. Without it nothing changes and the message names the file.
 * Also the path for a reused library design and a share link. The part keeps the measured outline
 * the file carries, so blocking is shaped the way it was saved; `units` words the notes.
 */
export async function loadDesign(
  file: DesignFile,
  glbs: File[],
  bundled: Part[] = catalog.parts,
  standards: ShopStandards = DEFAULT_STANDARDS,
  units: Units = "metric",
): Promise<Omit<LoadOutcome, "catalogAdditions">> {
  const saved = file.part;
  const entry = saved.source === "catalog" ? bundled.find((p) => p.id === saved.id) : undefined;
  const notes: string[] = [];
  let part: LoadedPart;

  const savedProfile = fileProfile(file);
  if (entry) {
    part = catalogPart(entry);
  } else {
    const glb = glbs.find((f) => f.name === saved.model) ?? (glbs.length === 1 ? glbs[0] : undefined);
    if (!glb) {
      const why = saved.source === "catalog" ? `This design uses ${saved.id}, which isn't in the catalog.` : `This design needs ${saved.model}.`;
      return { message: `${why} Choose its .glb together with the design file.` };
    }
    const read = await readGlb(glb);
    if (typeof read === "string") return { message: `${glb.name}: ${read}` };
    if (glb.name !== saved.model) notes.push(`Used ${glb.name} in place of ${saved.model}.`);
    // The saved units and axis are applied before measuring. A file from before they were saved
    // is read in the frame that gives its saved size, else guessed as a new file is.
    const fitted = saved.units === undefined ? fitFrame(read.raw, saved.dimensions_mm) : null;
    const frame: PartFrame = { up: saved.up ?? "z", units: saved.units ?? fitted?.units ?? guessedFrame(read.raw).units };
    const size = framedSizeMm(read.raw, frame);
    const same = size.every((v, i) => Math.abs(v - saved.dimensions_mm[i]) < SAME_MODEL_SIZE_MM);
    if (!same) notes.push(`${glb.name} is a different size from the saved part, so the crate follows the file.`);
    part = framePart(
      {
        id: saved.id,
        name: saved.name,
        material: saved.material,
        model: glb.name,
        mass_kg: saved.mass_kg,
        // The saved size is kept exactly when it is the same model, so the crate matches the file to the mm.
        dimensions_mm: same ? saved.dimensions_mm : size,
        suggested_quantities: DEFAULT_QUANTITIES,
        modelUrl: read.url,
        modelUnits: frame.units,
        upAxis: frame.up,
        unitsGuessed: false,
        mmPerUnit: 1,
        rawSize: read.raw,
        massAssumed: saved.massAssumed ?? false,
      },
      frame,
      saved.unitsGuessed === true || (saved.units === undefined && !fitted),
    );
    if (same) part = { ...part, dimensions_mm: saved.dimensions_mm };
  }

  // The saved outline is only for the model it was measured on. When it fits, the part has it
  // from the start, and the viewer's own measurement (which would match) is not needed.
  if (savedProfile && usableProfile({ dimensions_mm: part.dimensions_mm, profile: savedProfile })) part = { ...part, profile: savedProfile };
  const restored = restoreDesign(file, part, standards);
  const text = (m: Message) => renderMessage(m, units);
  return {
    part,
    design: { settings: restored.settings, layoutKey: restored.layoutKey, crateIndex: restored.crateIndex, ranking: restored.ranking },
    message: [`Design loaded: ${file.settings.quantity} × ${part.name}.`, ...notes, ...restored.notes.map(text)].join(" "),
  };
}

/**
 * The current part as it is written to a design file (spec §6.4). It is a catalog part when
 * the bundled catalog has it (even if its GLB was loaded from disk); anything else, including
 * entries from a dropped parts.json, is custom and needs its GLB to reopen.
 */
export function designFilePart(part: LoadedPart, bundled: Part[] = catalog.parts): DesignFilePart {
  const model = part.model ?? `${part.id}.glb`;
  const outline = part.profile && usableProfile(part) ? encoded(part.profile) : undefined;
  return {
    source: bundled.some((p) => p.id === part.id && p.model === model) ? "catalog" : "custom",
    id: part.id,
    name: part.name,
    ...(part.material ? { material: part.material } : {}),
    mass_kg: part.mass_kg,
    ...(part.massAssumed ? { massAssumed: true } : {}),
    dimensions_mm: part.dimensions_mm,
    units: part.modelUnits,
    up: part.upAxis,
    ...(part.unitsGuessed ? { unitsGuessed: true } : {}),
    model,
    ...(outline ? { outline } : {}),
  };
}

/** A profile packed once: designs are written on every edit, and the profile does not change. */
const packed = new WeakMap<PartProfile, ReturnType<typeof encodeProfile>>();
function encoded(profile: PartProfile) {
  let e = packed.get(profile);
  if (!e) packed.set(profile, (e = encodeProfile(profile)));
  return e;
}
