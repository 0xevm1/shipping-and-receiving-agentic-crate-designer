/**
 * The part's GLB bytes for a server-built crate GLB (#46 slice 6), always read from blob storage.
 *
 * - An uploaded part: its `part_model` object (`org/<orgId>/models/<sha256>.glb`), with the scale
 *   the upload was read at (`validation.readAsMm`: 1 mm per unit, else metres).
 * - A catalog part has no upload: the first build stores the app's bundled sample GLB
 *   (`public/parts/<model>`) as a `part_model` of the org, content-addressed like an upload (object
 *   first, then the row), and every later build reads it from the store like any other model.
 * - Neither: no model, and the GLB has the boards only.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catalog } from "@/domain/catalog";
import { modelKey } from "../blob/keys";
import type { BlobStore } from "../blob/store";
import type { OrgContext } from "../db/org";
import type { Part, Repository } from "../db/repository";

export type PartModelBytes = { bytes: ArrayBuffer; mmPerUnit: number; sha256: string };

const GLB_CONTENT_TYPE = "model/gltf-binary";

const toArrayBuffer = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

async function catalogModel(repo: Repository, blob: BlobStore, org: OrgContext, catalogId: string): Promise<PartModelBytes | null> {
  const entry = catalog.parts.find((p) => p.id === catalogId);
  if (!entry) return null;
  const file = new Uint8Array(await readFile(join(/* turbopackIgnore: true */ process.cwd(), "public", "parts", entry.model)));
  const sha256 = createHash("sha256").update(file).digest("hex");
  const key = modelKey(org, sha256);
  if (!(await repo.partModels.get(org, sha256)) || !(await blob.head(key))) {
    await blob.put(key, file, { contentType: GLB_CONTENT_TYPE });
    await repo.partModels.put(org, {
      sha256,
      sizeBytes: file.byteLength,
      objectKey: key,
      validation: { format: "glb", source: "catalog", catalogId, file: entry.model, readAsMm: false },
    });
  }
  const stored = await blob.get(key);
  if (!stored) throw new Error(`The catalog model ${key} vanished right after it was stored.`);
  return { bytes: toArrayBuffer(stored.body), mmPerUnit: 1000, sha256 };
}

/** The part's model bytes from blob storage, or null when the part has none. */
export async function partModelBytes(repo: Repository, blob: BlobStore, org: OrgContext, part: Part): Promise<PartModelBytes | null> {
  if (part.modelSha256) {
    const row = await repo.partModels.get(org, part.modelSha256);
    const stored = row ? await blob.get(modelKey(org, row.sha256)) : undefined;
    // A row without its object is a broken store, not a part without a model: fail loudly.
    if (!row || !stored) throw new Error(`The model ${part.modelSha256} of part ${part.id} is missing from blob storage.`);
    return { bytes: toArrayBuffer(stored.body), mmPerUnit: row.validation.readAsMm === true ? 1 : 1000, sha256: row.sha256 };
  }
  if (part.catalogId) return catalogModel(repo, blob, org, part.catalogId);
  return null;
}
