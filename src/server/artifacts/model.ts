/**
 * The part's GLB bytes for a server-built crate GLB (#46 slice 6), always read from blob storage.
 *
 * - An uploaded part: its `part_model` object (`org/<orgId>/models/<sha256>.glb`), read in the
 *   part's frame (spec §4: `part.modelUnits`, `part.upAxis`). A part uploaded before the frame was
 *   recorded is read as it was then: Z up, millimetres when `validation.readAsMm`, else metres.
 * - A catalog part has no upload: the first build stores the app's bundled sample GLB
 *   (`public/parts/<model>`) as a `part_model` of the org, content-addressed like an upload (object
 *   first, then the row), and every later build reads it from the store like any other model.
 * - Neither: no model, and the GLB has the boards only.
 *
 * `partModelSha256` names the model without reading it, for the keys of files that embed it
 * (`artifactKey(…, "crate.glb", modelSha256)`, the bundle id): the engine's `inputHash` hashes the
 * part's design fields only, so two parts with equal fields but different meshes share it.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catalog } from "@/domain/catalog";
import { MM_PER_UNIT, type UpAxis } from "@/domain/partFrame";
import { modelKey } from "../blob/keys";
import type { BlobStore } from "../blob/store";
import type { OrgContext } from "../db/org";
import type { Part, Repository } from "../db/repository";

export type PartModelBytes = { bytes: ArrayBuffer; mmPerUnit: number; upAxis: UpAxis; sha256: string };

const GLB_CONTENT_TYPE = "model/gltf-binary";

const toArrayBuffer = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

async function catalogFile(catalogId: string): Promise<{ file: Uint8Array; sha256: string; name: string } | null> {
  const entry = catalog.parts.find((p) => p.id === catalogId);
  if (!entry) return null;
  const file = new Uint8Array(await readFile(join(/* turbopackIgnore: true */ process.cwd(), "public", "parts", entry.model)));
  return { file, sha256: createHash("sha256").update(file).digest("hex"), name: entry.model };
}

/** The bundled sample GLBs don't change while the process runs: hash each once. */
const catalogShas = new Map<string, Promise<string | null>>();

/** The sha256 of the model a part's files embed, or null when it has none (no bytes are fetched from blob storage). */
export function partModelSha256(part: Part): Promise<string | null> {
  if (part.modelSha256) return Promise.resolve(part.modelSha256);
  if (!part.catalogId) return Promise.resolve(null);
  const id = part.catalogId;
  let sha = catalogShas.get(id);
  if (!sha) {
    sha = catalogFile(id).then((f) => f?.sha256 ?? null);
    sha.catch(() => catalogShas.delete(id));
    catalogShas.set(id, sha);
  }
  return sha;
}

async function catalogModel(repo: Repository, blob: BlobStore, org: OrgContext, catalogId: string): Promise<PartModelBytes | null> {
  const found = await catalogFile(catalogId);
  if (!found) return null;
  const { file, sha256 } = found;
  const key = modelKey(org, sha256);
  if (!(await repo.partModels.get(org, sha256)) || !(await blob.head(key))) {
    await blob.put(key, file, { contentType: GLB_CONTENT_TYPE });
    await repo.partModels.put(org, {
      sha256,
      sizeBytes: file.byteLength,
      objectKey: key,
      validation: { format: "glb", source: "catalog", catalogId, file: found.name, readAsMm: false },
    });
  }
  const stored = await blob.get(key);
  if (!stored) throw new Error(`The catalog model ${key} vanished right after it was stored.`);
  return { bytes: toArrayBuffer(stored.body), mmPerUnit: MM_PER_UNIT.m, upAxis: "z", sha256 };
}

/** The part's model bytes from blob storage, or null when the part has none. */
export async function partModelBytes(repo: Repository, blob: BlobStore, org: OrgContext, part: Part): Promise<PartModelBytes | null> {
  if (part.modelSha256) {
    const row = await repo.partModels.get(org, part.modelSha256);
    const stored = row ? await blob.get(modelKey(org, row.sha256)) : undefined;
    // A row without its object is a broken store, not a part without a model: fail loudly.
    if (!row || !stored) throw new Error(`The model ${part.modelSha256} of part ${part.id} is missing from blob storage.`);
    const units = part.modelUnits ?? (row.validation.readAsMm === true ? "mm" : "m");
    return { bytes: toArrayBuffer(stored.body), mmPerUnit: MM_PER_UNIT[units], upAxis: part.upAxis ?? "z", sha256: row.sha256 };
  }
  if (part.catalogId) return catalogModel(repo, blob, org, part.catalogId);
  return null;
}
