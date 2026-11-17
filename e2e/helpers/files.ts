import { readFileSync } from "node:fs";
import { type Download } from "@playwright/test";
import { unzipSync } from "fflate";

/** The sample models in `public/parts/`. */
export const BRACKET = "PART-001-machined-steel-bracket.glb";
export const SHAFT = "PART-002-long-steel-shaft.glb";
export const HOUSING = "PART-003-irregular-aluminum-housing.glb";

/** A sample model from `public/parts/` as an in-memory upload under any file name. */
export function sampleFile(model: string, name = model) {
  return { name, mimeType: "model/gltf-binary", buffer: readFileSync(`public/parts/${model}`) };
}

/** A design (or library) JSON text as an in-memory upload. */
export function jsonFile(text: string, name = "crate-design.json") {
  return { name, mimeType: "application/json", buffer: Buffer.from(text) };
}

/** What a download saved: its bytes, read from Playwright's temporary copy. */
export async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFileSync(path);
}

export async function readDownloadText(download: Download): Promise<string> {
  return (await readDownload(download)).toString("utf8");
}

/** The entries of a downloaded .zip. */
export async function readDownloadZip(download: Download) {
  return unzipSync(new Uint8Array(await readDownload(download)));
}

/**
 * A minimal valid GLB: one triangle spanning `size` model units (x, y, z). Used for a part that
 * is read as millimetres and is over the 20 m limit, or for a 1 mm part.
 */
export function triangleGlb(size: [number, number, number]): Buffer {
  const [x, y, z] = size;
  const positions = new Float32Array([0, 0, 0, x, y, 0, 0, 0, z]);
  const bin = Buffer.from(positions.buffer);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [x, y, z] }],
  };
  const pad = (b: Buffer, fill: number) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binChunk)]);
}
