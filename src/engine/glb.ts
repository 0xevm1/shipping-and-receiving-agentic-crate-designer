import type { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CrateDesign } from "@/domain/crate";
import { exportCrateGlb, loadPartScene, type PartModel } from "@/lib/exportGlb";
import type { LoadedPart } from "@/lib/part";

/**
 * GLB reading and writing behind runtime adapters (spec §5.1). Loaded only with `import()`
 * (it pulls in three.js's glTF loader and exporter).
 *
 * - Reading a part's model: in the browser `GLTFLoader` fetches the model URL (usually already
 *   in the viewer's cache); in Node there is no page to fetch from, so the bytes are parsed with
 *   `GLTFLoader.parse`. Both give the same scene for the same bytes.
 * - Writing the crate: `GLTFExporter`'s binary path reads its Blobs with `FileReader`, which
 *   browsers and workers have and Node doesn't. `ensureFileReader` adds a minimal one where it
 *   is missing (Blob itself is built into Node).
 */

/** Gives the part's model scene for a loaded part. */
export type PartModelReader = (part: LoadedPart) => Promise<Object3D>;

/** Browser: the model at the part's URL, loaded once and cached (`loadPartScene`). */
export const urlModelReader: PartModelReader = (part) => loadPartScene(part.modelUrl);

/** A GLB's bytes as a scene. Works in every runtime (no fetch, no DOM) for GLBs without textures. */
export async function parseGlb(bytes: ArrayBuffer): Promise<Object3D> {
  return (await new GLTFLoader().parseAsync(bytes, "")).scene;
}

/** Node (or any caller holding the bytes): the part's model parsed from `bytes`, once. */
export function bytesModelReader(bytes: ArrayBuffer): PartModelReader {
  let scene: Promise<Object3D> | null = null;
  return () => (scene ??= parseGlb(bytes));
}

/** Adds a minimal `FileReader` (readAsArrayBuffer, onload/onloadend) when the runtime has none. */
export function ensureFileReader(): void {
  const g = globalThis as { FileReader?: unknown };
  if (typeof g.FileReader !== "undefined") return;
  class BlobReader {
    result: ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onloadend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      blob.arrayBuffer().then(
        (b) => {
          this.result = b;
          this.onload?.();
          this.onloadend?.();
        },
        (e) => this.onerror?.(e),
      );
    }
  }
  g.FileReader = BlobReader;
}

/** The crate (with the parts in place when a model is given) as binary glTF, in any runtime. */
export async function crateGlb(design: CrateDesign, model?: PartModel | null): Promise<ArrayBuffer> {
  ensureFileReader();
  return exportCrateGlb(design, model);
}

/** A GLB maker for the bundle: each crate design with this part's model in its slots. */
export function glbMaker(part: LoadedPart, read: PartModelReader): (design: CrateDesign) => Promise<ArrayBuffer> {
  return async (design) => crateGlb(design, { scene: await read(part), mmPerUnit: part.mmPerUnit, material: part.material });
}
