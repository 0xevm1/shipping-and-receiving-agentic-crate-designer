/**
 * Binary glTF (.glb) checks and measurement, with no three.js, so the browser (src/lib/loadPart.ts)
 * and the server (POST /api/v1/parts, #46) accept and reject the same files with the same words.
 * Reads only the 12-byte header, the chunk headers and the JSON chunk; never the mesh data.
 */
import type { Vec3 } from "./schema";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/** The largest GLB the API accepts (and the browser caches, `MAX_CACHED_GLB_BYTES`). */
export const MAX_GLB_BYTES = 50 * 1024 * 1024;

/**
 * Files are expected in metres (spec §4). A part more than this many units across was almost
 * certainly modelled in millimetres, so it is read that way and the UI says so.
 */
const MM_FILE_THRESHOLD = 20;

/** What the user is told about a file that can't be used. One wording, browser and API. */
export const GLB_MESSAGES = {
  notGlb: "That isn't a .glb file. Choose a .glb or a design .json.",
  compressed: "That .glb uses compression the viewer can't read. Export it without Draco or Meshopt.",
  damaged: "That .glb file is damaged. Try exporting it again.",
  textGltf: "Text .gltf files can't be used. Export the part as a single .glb file.",
  noGeometry: "No solid geometry was found in this file.",
  tooLarge: `That .glb is larger than ${MAX_GLB_BYTES / 1024 / 1024} MB. Simplify the model or export it without textures.`,
} as const;

type Bytes = ArrayBuffer | Uint8Array;
const asBytes = (b: Bytes) => (b instanceof Uint8Array ? b : new Uint8Array(b));

type GlbJson = {
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[]; normalized?: boolean; componentType?: number }[];
};

type Parsed = { ok: true; json: GlbJson } | { ok: false; problem: string };

/** Header, version, chunk bounds and the JSON chunk; the problem message when any is wrong. */
function parseGlb(input: Bytes): Parsed {
  const bytes = asBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES || view.getUint32(0, true) !== GLB_MAGIC) {
    return { ok: false, problem: GLB_MESSAGES.notGlb };
  }
  const damaged = { ok: false, problem: GLB_MESSAGES.damaged } as const;
  if (view.getUint32(4, true) !== GLB_VERSION) return damaged;
  const declared = view.getUint32(8, true);
  if (declared > bytes.byteLength) return damaged;
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON || HEADER_BYTES + CHUNK_HEADER_BYTES + jsonLength > declared) return damaged;
  // Every later chunk must fit in the declared length too.
  for (let at = HEADER_BYTES + CHUNK_HEADER_BYTES + jsonLength; at < declared;) {
    if (at + CHUNK_HEADER_BYTES > declared) return damaged;
    const length = view.getUint32(at, true);
    at += CHUNK_HEADER_BYTES + length;
    if (at > declared) return damaged;
  }
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    if (typeof json !== "object" || json === null) return damaged;
    return { ok: true, json };
  } catch {
    return damaged;
  }
}

/** Why a .glb can't be used, or null if it looks fine. Reads only the header and JSON chunk. */
export function glbProblem(buffer: Bytes): string | null {
  const parsed = parseGlb(buffer);
  if (!parsed.ok) return parsed.problem;
  const required = parsed.json.extensionsRequired ?? [];
  if (required.some((e) => /draco|meshopt/i.test(e))) return GLB_MESSAGES.compressed;
  return null;
}

/** True for bytes that look like a text glTF (JSON) rather than a binary .glb. */
export function looksLikeTextGltf(buffer: Bytes): boolean {
  const bytes = asBytes(buffer);
  for (const b of bytes.subarray(0, 64)) {
    if (b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0xef || b === 0xbb || b === 0xbf) continue; // whitespace, BOM
    return b === 0x7b; // "{"
  }
  return false;
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

// --- Measuring ----------------------------------------------------------------------------------

type Mat4 = number[]; // column-major, as glTF stores it

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function compose(t: number[] = [0, 0, 0], q: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q as [number, number, number, number];
  const [sx, sy, sz] = s as [number, number, number];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    t[0]!,
    t[1]!,
    t[2]!,
    1,
  ];
}

/** Normalised integer accessors (KHR_mesh_quantization) store min / max as raw integers. */
function dequantize(v: number, accessor: { normalized?: boolean; componentType?: number }): number {
  if (!accessor.normalized) return v;
  switch (accessor.componentType) {
    case 5120:
      return Math.max(v / 127, -1);
    case 5121:
      return v / 255;
    case 5122:
      return Math.max(v / 32767, -1);
    case 5123:
      return v / 65535;
    default:
      return v;
  }
}

/**
 * The size of the default scene's bounding box in file units, [x, y, z]: each mesh primitive's
 * POSITION min / max (required by glTF) transformed by its node's world matrix. That is what
 * three's `Box3.setFromObject` gives for a loaded GLB, without loading the mesh. Null when the
 * file is unusable or has no geometry.
 */
export function glbSizeUnits(buffer: Bytes): Vec3 | null {
  const parsed = parseGlb(buffer);
  if (!parsed.ok) return null;
  const { json } = parsed;
  const nodes = json.nodes ?? [];
  let roots = json.scenes?.[json.scene ?? 0]?.nodes;
  if (!roots) {
    const children = new Set(nodes.flatMap((n) => n.children ?? []));
    roots = nodes.map((_, i) => i).filter((i) => !children.has(i));
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (index: number, parent: Mat4, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 256) return;
    const local = node.matrix?.length === 16 ? node.matrix : compose(node.translation, node.rotation, node.scale);
    const world = multiply(parent, local);
    for (const primitive of json.meshes?.[node.mesh ?? -1]?.primitives ?? []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION ?? -1];
      if (!accessor?.min || !accessor.max || accessor.min.length < 3 || accessor.max.length < 3) continue;
      const lo = accessor.min.map((v) => dequantize(v, accessor));
      const hi = accessor.max.map((v) => dequantize(v, accessor));
      for (let corner = 0; corner < 8; corner++) {
        const p = [corner & 1 ? hi[0]! : lo[0]!, corner & 2 ? hi[1]! : lo[1]!, corner & 4 ? hi[2]! : lo[2]!];
        for (let r = 0; r < 3; r++) {
          const v = world[r]! * p[0]! + world[4 + r]! * p[1]! + world[8 + r]! * p[2]! + world[12 + r]!;
          min[r] = Math.min(min[r]!, v);
          max[r] = Math.max(max[r]!, v);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  for (const root of roots) visit(root, IDENTITY, 0);
  const size = [0, 1, 2].map((i) => max[i]! - min[i]!);
  if (size.some((v) => !Number.isFinite(v)) || size.every((v) => v === 0)) return null;
  return size as Vec3;
}

/** Measured file units → mm, reading a part more than `MM_FILE_THRESHOLD` units across as mm. */
export function unitsToMm(sizeUnits: Vec3): { sizeMm: Vec3; mmPerUnit: number; readAsMm: boolean } {
  const readAsMm = Math.max(...sizeUnits) > MM_FILE_THRESHOLD;
  const mmPerUnit = readAsMm ? 1 : 1000;
  return { sizeMm: sizeUnits.map((v) => v * mmPerUnit) as Vec3, mmPerUnit, readAsMm };
}
