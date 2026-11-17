import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { catalog } from "@/domain/catalog";
import { fileProfile, isDesignFileJson, parseDesignFile, restoreDesign, type DesignFile, type DesignFilePart } from "@/domain/designFile";
import type { Ranking } from "@/domain/design";
import type { Message } from "@/domain/message";
import { usableProfile, type PartProfile } from "@/domain/profile";
import { encodeProfile } from "@/domain/profileCodec";
import { PartSchema, type CrateSettings, type Part, type Vec3 } from "@/domain/schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "@/domain/standards";
import { catalogPart, type LoadedPart } from "./part";
import { renderMessage } from "./message";
import type { Units } from "./units";

/** Mass used for an unknown part until the user enters one. Never inferred from the mesh (spec §6.1). */
const STAND_IN_MASS_KG = 10;
/**
 * Files are expected in metres (spec §4). A part more than this many units
 * across was almost certainly modelled in millimetres, so it is read that way
 * and the UI says so.
 */
const MM_FILE_THRESHOLD = 20;
const DEFAULT_QUANTITIES = [1, 4, 8];
const GLB_MAGIC = 0x46546c67; // "glTF"

/** Why a .glb can't be used, or null if it looks fine. Reads only the header and JSON chunk. */
export function glbProblem(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) return "That isn't a .glb file. Choose a .glb or a design .json.";
  const jsonLength = view.getUint32(12, true);
  try {
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
    const required: string[] = json.extensionsRequired ?? [];
    if (required.some((e) => /draco|meshopt/i.test(e))) {
      return "That .glb uses compression the viewer can't read. Export it without Draco or Meshopt.";
    }
  } catch {
    return "That .glb file is damaged. Try exporting it again.";
  }
  return null;
}

/** The part id a file name gives: the name without ".glb"; "part" for a file that is only ".glb". */
export function idFromFile(fileName: string): string {
  return fileName.replace(/\.glb$/i, "").trim() || "part";
}

/** "PART-004-cast-iron-cover.glb" → "Cast iron cover"; a file called only ".glb" is "Part". */
export function nameFromFile(fileName: string): string {
  const stem = idFromFile(fileName);
  const words = stem.replace(/^PART-\d+-/i, "").replace(/[-_]+/g, " ").trim() || stem;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Entries from a dropped parts.json that pass the catalog schema; none when it is not JSON. */
export function partsFromJson(text: string): Part[] {
  try {
    return catalogEntries(JSON.parse(text));
  } catch {
    return [];
  }
}

function catalogEntries(json: unknown): Part[] {
  const parts = (json as { parts?: unknown } | null)?.parts;
  const list: unknown[] = Array.isArray(parts) ? parts : [];
  return list.flatMap((p) => {
    const r = PartSchema.safeParse(p);
    return r.success ? [r.data] : [];
  });
}

async function measure(buffer: ArrayBuffer): Promise<Vec3> {
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
  if (size.lengthSq() === 0) throw new Error("No solid geometry was found in this file.");
  return [size.x, size.y, size.z];
}

interface ReadGlb {
  url: string;
  sizeMm: Vec3;
  mmPerUnit: number;
  readAsMm: boolean;
}

/** Validates and measures a GLB, then makes an object URL for it. A string is a problem message. */
async function readGlb(glb: File): Promise<ReadGlb | string> {
  const buffer = await glb.arrayBuffer();
  const problem = glbProblem(buffer);
  if (problem) return problem;
  const sizeUnits = await measure(buffer);
  const readAsMm = Math.max(...sizeUnits) > MM_FILE_THRESHOLD;
  const mmPerUnit = readAsMm ? 1 : 1000;
  const sizeMm = sizeUnits.map((v) => v * mmPerUnit) as Vec3;
  const url = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
  return { url, sizeMm, mmPerUnit, readAsMm };
}

export interface LoadOutcome {
  part?: LoadedPart;
  /** Settings and layout to restore with `part`, when a design file was loaded. */
  design?: { settings: CrateSettings; layoutKey: string | null; crateIndex: number; ranking: Ranking };
  catalogAdditions: Part[];
  message: string;
}

/**
 * Turns dropped or picked files into a part. `units` is how any note on a design is worded. A JSON file is either a saved design (by its
 * `kind`, spec §6.4) or a parts.json catalog.
 * - A design restores its part, rules and layout (`loadDesign`).
 * - Otherwise a parts.json adds catalog entries first, and a .glb whose file name matches a
 *   catalog `model` takes that entry's mass, material and quantities. Anything else gets a
 *   stand-in mass.
 */
export async function loadPartFiles(
  files: File[],
  known: Part[],
  bundled: Part[] = catalog.parts,
  /** The shop standards a saved design is rebuilt with (and its shipment re-planned). */
  standards: ShopStandards = DEFAULT_STANDARDS,
  units: Units = "metric",
): Promise<LoadOutcome> {
  const catalogAdditions: Part[] = [];
  let designText: string | null = null;
  for (const f of files.filter((f) => /\.json$/i.test(f.name))) {
    const text = await f.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { catalogAdditions, message: `${f.name} isn't valid JSON. Choose a design or parts .json file.` };
    }
    if (isDesignFileJson(json)) designText ??= text;
    else catalogAdditions.push(...catalogEntries(json));
  }
  const glbs = files.filter((f) => /\.glb$/i.test(f.name));

  if (designText !== null) {
    const parsed = parseDesignFile(designText);
    if (!parsed.ok) return { catalogAdditions, message: parsed.error };
    return { catalogAdditions, ...(await loadDesign(parsed.file, glbs, bundled, standards, units)) };
  }

  const glb = glbs[0];
  if (!glb) {
    const message = catalogAdditions.length
      ? "Part details loaded. Now choose its .glb file."
      : files.some((f) => /\.gltf$/i.test(f.name))
        ? "Text .gltf files can't be used. Export the part as a single .glb file."
        : "Choose a .glb file or a design .json.";
    return { catalogAdditions, message };
  }

  const read = await readGlb(glb);
  if (typeof read === "string") return { catalogAdditions, message: read };
  const { url, sizeMm, mmPerUnit, readAsMm } = read;

  const match = [...known, ...catalogAdditions].find((p) => p.model === glb.name);
  if (match) {
    return { catalogAdditions, message: "", part: { ...catalogPart(match, url), mmPerUnit, readAsMm } };
  }
  return {
    catalogAdditions,
    message: "",
    part: {
      id: idFromFile(glb.name),
      name: nameFromFile(glb.name),
      model: glb.name,
      mass_kg: STAND_IN_MASS_KG,
      dimensions_mm: sizeMm,
      suggested_quantities: DEFAULT_QUANTITIES,
      modelUrl: url,
      mmPerUnit,
      massAssumed: true,
      readAsMm,
    },
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
      const why =
        saved.source === "catalog"
          ? `This design uses ${saved.id}, which isn't in the catalog.`
          : `This design needs ${saved.model}.`;
      return { message: `${why} Choose its .glb together with the design file.` };
    }
    const read = await readGlb(glb);
    if (typeof read === "string") return { message: `${glb.name}: ${read}` };
    if (glb.name !== saved.model) notes.push(`Used ${glb.name} in place of ${saved.model}.`);
    const same = read.sizeMm.every((v, i) => Math.abs(v - saved.dimensions_mm[i]) < SAME_MODEL_SIZE_MM);
    if (!same) notes.push(`${glb.name} is a different size from the saved part, so the crate follows the file.`);
    part = {
      id: saved.id,
      name: saved.name,
      material: saved.material,
      model: glb.name,
      mass_kg: saved.mass_kg,
      dimensions_mm: same ? saved.dimensions_mm : read.sizeMm,
      suggested_quantities: DEFAULT_QUANTITIES,
      modelUrl: read.url,
      mmPerUnit: read.mmPerUnit,
      massAssumed: saved.massAssumed ?? false,
      readAsMm: read.readAsMm,
    };
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
