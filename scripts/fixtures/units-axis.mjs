// Writes the part files for the units and up-axis scenarios (issue #105) into fixtures/units-axis/:
// PART-001 (the machined steel bracket) as a user might hand it over in another frame. Each file
// is the bracket's own geometry, with every vertex position rewritten and nothing else changed.
//
//   bun scripts/fixtures/units-axis.mjs
//
// The output is deterministic: the same bytes on every run, so `git diff` shows a real change.
// Self-contained on purpose (no app imports): it reads public/parts/ and writes fixtures/units-axis/.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = join(root, "public", "parts", "PART-001-machined-steel-bracket.glb");
const OUT = join(root, "fixtures", "units-axis");

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;

/** Splits a GLB into its JSON document and binary chunk. */
function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength + 8;
  const binLength = view.getUint32(20 + jsonLength, true);
  return { json, bin: bytes.slice(binStart, binStart + binLength) };
}

const pad = (bytes, fill) => {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
  out.set(bytes);
  return out;
};

function writeGlb(json, bin) {
  const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = pad(bin, 0);
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  const at = 20 + jsonBytes.length;
  view.setUint32(at, binBytes.length, true);
  view.setUint32(at + 4, BIN_CHUNK, true);
  out.set(binBytes, at + 8);
  return out;
}

/**
 * The part with each vertex position sent through `move` ([x, y, z] to [x, y, z]), and the
 * accessor bounds updated to match. The model has no node transforms, so this is the whole change.
 */
function transformed(source, move) {
  const { json, bin } = readGlb(source);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const positions = new Set(json.meshes.flatMap((m) => m.primitives.map((p) => p.attributes.POSITION)));
  for (const index of positions) {
    const a = json.accessors[index];
    if (a.type !== "VEC3" || a.componentType !== FLOAT) throw new Error("expected float VEC3 positions");
    const view = json.bufferViews[a.bufferView];
    if (view.byteStride) throw new Error("interleaved positions are not handled");
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.count; i++) {
      const at = start + i * 12;
      const p = move([data.getFloat32(at, true), data.getFloat32(at + 4, true), data.getFloat32(at + 8, true)]);
      p.forEach((v, k) => {
        data.setFloat32(at + 4 * k, v, true);
        const stored = data.getFloat32(at + 4 * k, true);
        min[k] = Math.min(min[k], stored);
        max[k] = Math.max(max[k], stored);
      });
    }
    a.min = min;
    a.max = max;
  }
  return writeGlb(json, bin);
}

const scaled = (k) => (p) => p.map((v) => v * k);
/** Z up to Y up: a quarter turn about X, (x, y, z) to (x, z, -y), so nothing mirrors. */
const yUp = ([x, y, z]) => [x, z, -y];
/** Far from the origin, in metres: the part is 0.36 m long and sits tens of metres away. */
const OFF_ORIGIN_M = [52.4, -31.7, 14.2];
const shifted = (by) => (p) => p.map((v, k) => v + by[k]);

const files = {
  "bracket-metres.glb": (g) => transformed(g, scaled(1)),
  "bracket-millimetres.glb": (g) => transformed(g, scaled(1000)),
  "bracket-inches.glb": (g) => transformed(g, scaled(1000 / 25.4)),
  "bracket-y-up.glb": (g) => transformed(g, yUp),
  "bracket-off-origin.glb": (g) => transformed(g, shifted(OFF_ORIGIN_M)),
};

const source = new Uint8Array(readFileSync(SOURCE));
mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(files)) {
  const bytes = make(source);
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}
