import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PartSchema, type Part, type Vec3 } from "@/domain/schema";
import { catalogPart, type LoadedPart } from "@/state/store";

/** Mass used for an unknown part until the user enters one. Never inferred from the mesh (spec §6.1). */
export const STAND_IN_MASS_KG = 10;
/**
 * Files are expected in metres (spec §4). A part more than this many units
 * across was almost certainly modelled in millimetres, so it is read that way
 * and the UI says so.
 */
export const MM_FILE_THRESHOLD = 20;
const DEFAULT_QUANTITIES = [1, 4, 8];
const GLB_MAGIC = 0x46546c67; // "glTF"

/** Why a .glb can't be used, or null if it looks fine. Reads only the header and JSON chunk. */
export function glbProblem(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) return "That is not a .glb file.";
  const jsonLength = view.getUint32(12, true);
  try {
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
    const required: string[] = json.extensionsRequired ?? [];
    if (required.some((e) => /draco|meshopt/i.test(e))) {
      return "This file is compressed in a way the viewer cannot read. Export it without Draco or Meshopt compression.";
    }
  } catch {
    return "That .glb file is damaged.";
  }
  return null;
}

/** "PART-004-cast-iron-cover.glb" → "Cast iron cover". */
export function nameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.glb$/i, "");
  const words = stem.replace(/^PART-\d+-/i, "").replace(/[-_]+/g, " ").trim() || stem;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Entries from a dropped parts.json that pass the catalog schema. */
export function partsFromJson(text: string): Part[] {
  const json = JSON.parse(text);
  const list: unknown[] = Array.isArray(json?.parts) ? json.parts : [];
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

export interface LoadOutcome {
  part?: LoadedPart;
  catalogAdditions: Part[];
  message: string;
}

/**
 * Turns dropped or picked files into a part. A parts.json adds catalog entries
 * first; a .glb whose file name matches a catalog `model` takes that entry's
 * mass, material and quantities. Anything else gets a stand-in mass.
 */
export async function loadPartFiles(files: File[], known: Part[]): Promise<LoadOutcome> {
  const catalogAdditions: Part[] = [];
  for (const f of files.filter((f) => /\.json$/i.test(f.name))) {
    catalogAdditions.push(...partsFromJson(await f.text()));
  }
  const lookup = [...known, ...catalogAdditions];

  const glb = files.find((f) => /\.glb$/i.test(f.name));
  if (!glb) {
    const message = catalogAdditions.length
      ? "Part details loaded. Now add the .glb file."
      : files.some((f) => /\.gltf$/i.test(f.name))
        ? "Text .gltf files are not supported. Export the part as a single .glb file."
        : "Choose a .glb file.";
    return { catalogAdditions, message };
  }

  const buffer = await glb.arrayBuffer();
  const problem = glbProblem(buffer);
  if (problem) return { catalogAdditions, message: problem };

  const sizeUnits = await measure(buffer);
  const readAsMm = Math.max(...sizeUnits) > MM_FILE_THRESHOLD;
  const mmPerUnit = readAsMm ? 1 : 1000;
  const sizeMm = sizeUnits.map((v) => v * mmPerUnit) as Vec3;
  const url = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));

  const match = lookup.find((p) => p.model === glb.name);
  if (match) {
    return { catalogAdditions, message: "", part: { ...catalogPart(match, url), mmPerUnit, readAsMm } };
  }
  const name = nameFromFile(glb.name);
  return {
    catalogAdditions,
    message: "",
    part: {
      id: glb.name.replace(/\.glb$/i, ""),
      name,
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
