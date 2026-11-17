/**
 * Binary glTF (.glb) checks, with no three.js, so the browser's file check (src/lib/fileCheck.ts), the
 * upload API (POST /api/v1/parts, #46) and the CLI accept and reject the same files with the same
 * words. The reading itself is `readGlb` (`glbInfo.ts`); this module turns its answer into sentences.
 */
import { readGlb, type GlbProblem } from "./glbInfo";
import type { Vec3 } from "./schema";

export { readGlb, type GlbProblem } from "./glbInfo";

/** The largest GLB the API accepts (and the browser caches, `MAX_CACHED_GLB_BYTES`). */
export const MAX_GLB_BYTES = 50 * 1024 * 1024;

/** Messages about a file that aren't about its contents. One wording, browser and API. */
export const GLB_MESSAGES = {
  textGltf: "Text .gltf files can't be used. Export the part as a single .glb file.",
  tooLarge: `That .glb is larger than ${MAX_GLB_BYTES / 1024 / 1024} MB. Simplify the model or export it without textures.`,
} as const;

type Bytes = ArrayBuffer | Uint8Array;

/** The sentence for a .glb that can't be used: what is wrong and what to do. Errors carry no sizes, so none needs the units toggle. */
export function glbProblemMessage(p: GlbProblem): string {
  switch (p.kind) {
    case "not-glb":
      return `It has a .glb name but isn't a binary glTF${p.looksLike ? ` (it looks like ${p.looksLike})` : ""}. Export the part again as .glb; renaming a file doesn't convert it.`;
    case "version":
      return `It is glTF version ${p.version}, and the app reads version 2. Export the part again as a .glb (glTF 2.0).`;
    case "damaged":
      return "That .glb file is damaged: it is cut off or its header can't be read. Try exporting it again.";
    case "compressed":
      return `That .glb uses ${p.extension} compression, which the viewer can't read. Export it again without ${p.extension === "Draco" ? "Draco" : "Meshopt"} compression.`;
    case "no-geometry":
      return "It has no 3D geometry in its scene (no mesh with points). Export the part itself, not just cameras, lights or an empty scene.";
    case "no-size":
      return "All its geometry sits at one point, so it has no size. Check the export has the part's real mesh.";
    case "flat":
      return `It is flat: zero thickness along ${"XYZ"[p.axis]}, so a crate can't be sized around it. Export the part as a solid.`;
  }
}

/** Why a .glb can't be used (`glbProblemMessage`), or null if it reads and has a size. */
export function glbProblem(buffer: Bytes): string | null {
  const r = readGlb(buffer);
  return "problem" in r ? glbProblemMessage(r.problem) : null;
}

/**
 * The size of the default scene's bounding box in file units, [x, y, z] (`readGlb`): what three's
 * `Box3.setFromObject` gives for a loaded GLB, without loading it. Null when the file can't be used.
 */
export function glbSizeUnits(buffer: Bytes): Vec3 | null {
  const r = readGlb(buffer);
  return "info" in r ? r.info.size : null;
}

/**
 * What the upload API and the CLI make of a picked file, by the file check's rules (§6.6): its size in
 * file units, or the sentence that says why not. `notGlb` is a file of another kind (a text .gltf, or
 * bytes that aren't a binary glTF), which the API answers with 415 rather than 422.
 */
export type GlbVerdict = { ok: true; sizeUnits: Vec3 } | { ok: false; message: string; notGlb: boolean };

export function checkGlbFile(bytes: Bytes, fileName: string): GlbVerdict {
  if (/\.gltf$/i.test(fileName)) return { ok: false, message: GLB_MESSAGES.textGltf, notGlb: true };
  const r = readGlb(bytes);
  if ("problem" in r) return { ok: false, message: glbProblemMessage(r.problem), notGlb: r.problem.kind === "not-glb" };
  return { ok: true, sizeUnits: r.info.size };
}

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
