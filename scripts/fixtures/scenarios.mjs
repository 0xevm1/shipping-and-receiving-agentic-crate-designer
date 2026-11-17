// Writes the demo-readiness fixtures (#114) into fixtures/scenarios/. Deterministic, no network, no DOM:
// the GLBs are hand-built glTF buffers (boxes, Z up, metres), so the same run gives the same bytes.
//
//   bun run fixtures        (or: bun scripts/fixtures/scenarios.mjs)
//
// The units / Y-up / off-origin files are a different script (scripts/fixtures/units-axis.mjs, #105).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "fixtures/scenarios";

/** One axis-aligned box as [min, max] corners in metres. */
const box = (x0, y0, z0, x1, y1, z1) => [
  [x0, y0, z0],
  [x1, y1, z1],
];
/** A box from the origin corner with the given size. */
const solid = (x, y, z) => box(0, 0, 0, x, y, z);

const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
const chunk = (type, data) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
};

/** Wraps a glTF JSON object and an optional binary buffer as a .glb. */
function glb(json, bin = Buffer.alloc(0)) {
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const chunks = [chunk(0x4e4f534a, jsonChunk)];
  if (bin.length) chunks.push(chunk(0x004e4942, pad(bin, 0)));
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

/** A .glb with one indexed mesh per box (12 triangles each). */
function boxesGlb(boxes) {
  const nodes = [];
  const meshes = [];
  const bufferViews = [];
  const accessors = [];
  const bins = [];
  let offset = 0;
  boxes.forEach(([lo, hi], i) => {
    const p = [];
    for (let c = 0; c < 8; c++) p.push(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]);
    const idx = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
    const pb = Buffer.from(new Float32Array(p).buffer);
    const ib = Buffer.from(new Uint16Array(idx).buffer);
    bins.push(pb, ib);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: pb.length, target: 34962 });
    offset += pb.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: ib.length, target: 34963 });
    offset += ib.length;
    accessors.push({ bufferView: i * 2, componentType: 5126, count: 8, type: "VEC3", min: lo, max: hi });
    accessors.push({ bufferView: i * 2 + 1, componentType: 5123, count: idx.length, type: "SCALAR" });
    meshes.push({ primitives: [{ attributes: { POSITION: i * 2 }, indices: i * 2 + 1 }] });
    nodes.push({ mesh: i });
  });
  const bin = Buffer.concat(bins);
  return glb(
    {
      asset: { version: "2.0", generator: "scripts/fixtures/scenarios.mjs" },
      scene: 0,
      scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes,
      meshes,
      buffers: [{ byteLength: bin.length }],
      bufferViews,
      accessors,
    },
    bin,
  );
}

/** A GLB whose JSON says a compression extension is required (the app reads only the JSON, so no mesh is needed). */
const compressedGlb = (extension) => glb({ asset: { version: "2.0" }, extensionsUsed: [extension], extensionsRequired: [extension] });

// --- Scenarios that are a part file ---------------------------------------------------------------
// Each: [file, mass kg, boxes (m), name]. Sizes are model units in metres, Z up.
const PARTS = [
  ["heavy-1500kg.glb", 1500, [solid(0.9, 0.7, 0.5)], "Heavy block 1500 kg"],
  ["heavy-2000kg.glb", 2000, [solid(0.9, 0.7, 0.5)], "Heavy block 2000 kg"],
  ["overweight-8000kg.glb", 8000, [solid(1.2, 0.8, 0.6)], "Overweight block 8000 kg"],
  ["wider-than-door.glb", 400, [solid(2.6, 2.6, 0.3)], "Plate wider than the trailer door"],
  ["taller-than-door.glb", 150, [solid(0.4, 0.4, 2.8)], "Mast taller than the trailer door"],
  ["longer-than-8ft.glb", 40, [solid(2.6, 0.3, 0.3)], "Rail longer than 8 ft"],
  ["tiny-light.glb", 0.05, [solid(0.04, 0.03, 0.02)], "Tiny light pin"],
  // A long shaft with a heavy block at one end: the mass sits near the block, not at the box centre.
  ["lopsided.glb", 120, [box(0, 0.1, 0.1, 1.0, 0.2, 0.2), box(1.0, 0, 0, 1.2, 0.3, 0.3)], "Lopsided shaft with end block"],
  ["tall-part.glb", 12, [solid(0.15, 0.15, 1.2)], "Tall post"],
  ["bigger-than-sheet.glb", 300, [solid(2.0, 1.4, 0.8)], "Crate wider than a plywood sheet"],
  ["pallet-overhang.glb", 200, [solid(1.3, 1.1, 1.0)], "Part over a pallet footprint"],
  // The catalog (parts-size-mismatch.json) says 360 x 220 x 258 mm; this model is 360 x 220 x 300.
  ["size-mismatch.glb", 20, [solid(0.36, 0.22, 0.3)], "Bracket whose model disagrees with the catalog"],
  ["missing-field.glb", 20, [solid(0.3, 0.2, 0.2)], "Part whose catalog entry has no mass"],
];

// --- Files that should get a plain message --------------------------------------------------------
const MESSAGES = {
  "draco.glb": compressedGlb("KHR_draco_mesh_compression"),
  "meshopt.glb": compressedGlb("EXT_meshopt_compression"),
  "not-a-model.glb": Buffer.from("this is a text file renamed to .glb"),
  "damaged.glb": glb({ asset: { version: "2.0" } }).subarray(0, 24), // the header and a cut-off JSON chunk
  "empty-scene.glb": glb({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] }),
  "text.gltf": Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }] }, null, 2)),
  "not-a-model.txt": Buffer.from("Not a model. The app asks for a .glb or a design .json.\n"),
  "not-json.json": Buffer.from("{ this is not json"),
};

const entry = (id, [file, mass, boxes, name]) => {
  const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b[0][a])));
  const hi = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b[1][a])));
  return {
    id,
    name,
    model: file,
    material: "4140 steel",
    density_kg_m3: 7850,
    mass_kg: mass,
    dimensions_mm: hi.map((v, a) => Math.round((v - lo[a]) * 1000)),
    suggested_quantities: [1, 4, 8],
  };
};

const catalog = (parts) => JSON.stringify({ schema_version: "1.0", coordinate_system: "right-handed; Z up", model_units: "meters", parts }, null, 2) + "\n";

mkdirSync(OUT, { recursive: true });
const write = (name, data) => writeFileSync(join(OUT, name), data);

for (const p of PARTS) write(p[0], boxesGlb(p[2]));
for (const [name, data] of Object.entries(MESSAGES)) write(name, data);

// One catalog that knows every part file above, except the two catalog scenarios, which have their own.
const own = new Set(["size-mismatch.glb", "missing-field.glb"]);
const entries = PARTS.filter((p) => !own.has(p[0])).map((p, i) => entry(`SCN-${String(i + 1).padStart(3, "0")}`, p));
write("parts.json", catalog(entries));

// A parts.json entry with no mass_kg (next to a good one): the app drops the bad entry without a word (#106).
const missing = PARTS.find((p) => p[0] === "missing-field.glb");
const noMass = entry("SCN-900", missing);
delete noMass.mass_kg;
write("parts-missing-field.json", catalog([noMass, entry("SCN-901", PARTS[0])]));

// An entry whose size differs from size-mismatch.glb: the model check says so.
const mismatch = entry(
  "SCN-902",
  PARTS.find((p) => p[0] === "size-mismatch.glb"),
);
write("parts-size-mismatch.json", catalog([{ ...mismatch, dimensions_mm: [360, 220, 258] }]));

console.log(`Wrote ${PARTS.length + Object.keys(MESSAGES).length + 3} files to ${OUT}/`);
