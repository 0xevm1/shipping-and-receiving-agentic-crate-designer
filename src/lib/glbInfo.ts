import type { Vec3 } from "@/domain/schema";

/**
 * What a .glb says about itself, read from its header, its JSON chunk and (when an accessor has no
 * bounds) its binary chunk. No WebGL, no DOM and no three.js, so it runs in the unit tests and in a
 * command-line script as well as in the browser. The rules that turn a problem into a sentence are
 * in `fileCheck.ts`.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/** Why a .glb can't be used. */
export type GlbProblem =
  /** Not a binary glTF at all; `looksLike` says what it seems to be instead, when that is obvious. */
  | { kind: "not-glb"; looksLike?: string }
  /** A binary glTF of a version other than 2. */
  | { kind: "version"; version: number }
  /** The header or a chunk is cut off, or the JSON can't be read. */
  | { kind: "damaged" }
  | { kind: "compressed"; extension: "Draco" | "Meshopt" }
  /** No mesh with positions in the default scene. */
  | { kind: "no-geometry" }
  /** Every point is the same point. */
  | { kind: "no-size" }
  /** One side is zero: the model has no thickness along this axis (0 = x, 1 = y, 2 = z). */
  | { kind: "flat"; axis: 0 | 1 | 2 };

/** The model as the file has it: file units, file axes. */
interface GlbInfo {
  size: Vec3;
  /** The middle of the bounding box. */
  center: Vec3;
}

export type GlbRead = { problem: GlbProblem } | { info: GlbInfo };

/** What a text file that was renamed to .glb most likely is, from its first bytes. */
function sniff(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder().decode(bytes.subarray(0, 16)).replace(/^﻿/, "").trimStart();
  if (head.startsWith("{")) return "a text glTF";
  if (/^solid\b/i.test(head)) return "an STL file";
  if (head.startsWith("ISO-10303")) return "a STEP file";
  if (head.startsWith("<")) return "an XML or Collada file";
  return undefined;
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteStride?: number }[];
  extensionsRequired?: string[];
}
interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

/** Column-major 4x4 matrices, as glTF writes them. */
type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function localMatrix(n: GltfNode): Mat4 {
  if (n.matrix?.length === 16) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx,
    2 * (qx * qy + qz * qw) * sx,
    2 * (qx * qz - qy * qw) * sx,
    0,
    2 * (qx * qy - qz * qw) * sy,
    (1 - 2 * (qx * qx + qz * qz)) * sy,
    2 * (qy * qz + qx * qw) * sy,
    0,
    2 * (qx * qz + qy * qw) * sz,
    2 * (qy * qz - qx * qw) * sz,
    (1 - 2 * (qx * qx + qy * qy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/** Largest integer of a normalized accessor's component type, to bring its bounds back to 0..1 or -1..1. */
const NORMALIZE: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/** The box a POSITION accessor spans: its own `min` and `max`, or else a scan of its float32 data. */
function accessorBounds(json: Gltf, bin: Uint8Array | null, index: number): { min: Vec3; max: Vec3 } | null {
  const acc = json.accessors?.[index];
  if (!acc || acc.type !== "VEC3") return null;
  const k = acc.normalized ? (NORMALIZE[acc.componentType] ?? 1) : 1;
  if (acc.min?.length === 3 && acc.max?.length === 3 && [...acc.min, ...acc.max].every(Number.isFinite)) {
    return { min: acc.min.map((v) => v / k) as Vec3, max: acc.max.map((v) => v / k) as Vec3 };
  }
  const view = acc.bufferView === undefined ? undefined : json.bufferViews?.[acc.bufferView];
  if (!bin || !view || view.buffer !== 0 || acc.componentType !== 5126 || acc.count < 1) return null;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < acc.count; i++) {
    const at = start + i * stride;
    if (at + 12 > bin.byteLength) return null;
    for (let a = 0; a < 3; a++) {
      const v = data.getFloat32(at + a * 4, true);
      if (!Number.isFinite(v)) return null;
      min[a] = Math.min(min[a], v);
      max[a] = Math.max(max[a], v);
    }
  }
  return { min, max };
}

/** The bounding box of the default scene in file units: each mesh's accessor bounds, carried through its node's transform. */
function sceneBounds(json: Gltf, bin: Uint8Array | null): { min: Vec3; max: Vec3 } | null {
  const nodes = json.nodes ?? [];
  const listed = json.scenes?.[json.scene ?? 0]?.nodes;
  const children = new Set(nodes.flatMap((n) => n.children ?? []));
  const roots = listed ?? nodes.map((_, i) => i).filter((i) => !children.has(i));
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let found = false;
  const visit = (i: number, parent: Mat4, depth: number) => {
    const node = nodes[i];
    if (!node || depth > 64) return;
    const world = multiply(parent, localMatrix(node));
    for (const prim of node.mesh === undefined ? [] : (json.meshes?.[node.mesh]?.primitives ?? [])) {
      const at = prim.attributes?.POSITION;
      const b = at === undefined ? null : accessorBounds(json, bin, at);
      if (!b) continue;
      found = true;
      for (let c = 0; c < 8; c++) {
        const p = [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]];
        for (let a = 0; a < 3; a++) {
          const v = world[a] * p[0] + world[4 + a] * p[1] + world[8 + a] * p[2] + world[12 + a];
          min[a] = Math.min(min[a], v);
          max[a] = Math.max(max[a], v);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  for (const r of roots) visit(r, IDENTITY, 0);
  return found ? { min, max } : null;
}

/** Reads a .glb: its size and centre, or the first reason it can't be used. */
export function readGlb(buffer: ArrayBuffer): GlbRead {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) return { problem: { kind: "not-glb", looksLike: sniff(bytes) } };
  const version = view.getUint32(4, true);
  if (version !== 2) return { problem: { kind: "version", version } };

  let json: Gltf | null = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= buffer.byteLength;) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    if (at + 8 + length > buffer.byteLength) return { problem: { kind: "damaged" } };
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === CHUNK_JSON && !json) {
      try {
        json = JSON.parse(new TextDecoder().decode(body)) as Gltf;
      } catch {
        return { problem: { kind: "damaged" } };
      }
    } else if (type === CHUNK_BIN && !bin) bin = body;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json || typeof json !== "object") return { problem: { kind: "damaged" } };

  const required = json.extensionsRequired ?? [];
  const packed = required.find((e) => /draco|meshopt/i.test(e));
  if (packed) return { problem: { kind: "compressed", extension: /draco/i.test(packed) ? "Draco" : "Meshopt" } };

  const box = sceneBounds(json, bin);
  if (!box) return { problem: { kind: "no-geometry" } };
  const size = box.max.map((v, a) => v - box.min[a]) as Vec3;
  if (size.every((v) => v < 1e-9)) return { problem: { kind: "no-size" } };
  const flat = size.findIndex((v) => v < 1e-9);
  if (flat >= 0) return { problem: { kind: "flat", axis: flat as 0 | 1 | 2 } };
  return { info: { size, center: box.max.map((v, a) => (v + box.min[a]) / 2) as Vec3 } };
}
