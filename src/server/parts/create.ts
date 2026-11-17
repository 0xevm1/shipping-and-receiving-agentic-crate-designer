/**
 * Upload a part (#46): `POST /api/v1/parts`. The GLB comes through the API, not straight to the
 * bucket, so validation lives in one place and gives the app's own messages (`src/domain/glb.ts`).
 *
 * Order matters: validate, hash, write the object, then the rows. A crash after the object leaves
 * an orphan that `blob:gc` removes after 24 h, never a row with nothing behind it. Objects are
 * content-addressed per org (`org/<orgId>/models/<sha256>.glb`), so the same file twice is one
 * object and one `part_model` row; each upload is still its own `part` (mass may differ).
 */
import { createHash } from "node:crypto";
import { GLB_MESSAGES, glbProblem, glbSizeUnits, looksLikeTextGltf, MAX_GLB_BYTES, nameFromFile, unitsToMm } from "@/domain/glb";
import { CreatePartFieldsSchema, type CreatePartResponse, type PartResponse } from "@/lib/api/parts";
import { modelKey } from "../blob/keys";
import { ORPHAN_AGE_MS } from "../blob/gc";
import type { BlobStore } from "../blob/store";
import type { OrgContext } from "../db/org";
import { type Database, inTransaction, type Part } from "../db/repository";
import { emitEvent } from "../events/emit";
import { ApiFailure } from "../http";

export type PartsDeps = { db: Database; blob: BlobStore; org: OrgContext };

/** Multipart overhead allowed on top of the file before the body is even read. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

const GLB_CONTENT_TYPE = "model/gltf-binary";

export function partResponse(part: Part): PartResponse {
  return {
    id: part.id,
    name: part.name,
    material: part.material,
    densityKgM3: part.densityKgM3,
    massKg: part.massKg,
    sizeMm: [part.sizeXMm, part.sizeYMm, part.sizeZMm],
    modelSha256: part.modelSha256,
    source: part.source,
    catalogId: part.catalogId,
    createdAt: part.createdAt.toISOString(),
  };
}

async function readForm(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(type)) {
    throw new ApiFailure(415, "invalid_request", "Send the part as multipart/form-data, with the .glb in a field named file.");
  }
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_GLB_BYTES + FORM_OVERHEAD_BYTES) throw new ApiFailure(413, "too_large", GLB_MESSAGES.tooLarge, "file");
  try {
    return await request.formData();
  } catch {
    throw new ApiFailure(400, "invalid_request", "The upload couldn't be read. Send it again as multipart/form-data.");
  }
}

/** The file's bytes, once it has passed every check the browser makes. */
async function checkedGlb(file: FormDataEntryValue | null): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (!(file instanceof File)) throw new ApiFailure(400, "invalid_request", "Add the part's .glb file, in a field named file.", "file");
  if (file.size > MAX_GLB_BYTES) throw new ApiFailure(413, "too_large", GLB_MESSAGES.tooLarge, "file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.gltf$/i.test(file.name) || looksLikeTextGltf(bytes)) throw new ApiFailure(415, "unsupported_file", GLB_MESSAGES.textGltf, "file");
  const problem = glbProblem(bytes);
  if (problem === GLB_MESSAGES.notGlb) throw new ApiFailure(415, "unsupported_file", problem, "file");
  if (problem) throw new ApiFailure(422, "invalid_glb", problem, "file");
  return { bytes, fileName: file.name };
}

export async function createPart(request: Request, { db, blob, org }: PartsDeps): Promise<CreatePartResponse> {
  const form = await readForm(request);
  const fields = CreatePartFieldsSchema.safeParse({
    mass: form.get("mass"),
    material: form.get("material"),
    density: form.get("density"),
    name: form.get("name"),
  });
  if (!fields.success) {
    const issue = fields.error.issues[0]!;
    throw new ApiFailure(400, "invalid_request", issue.message, issue.path.join("."));
  }
  const { bytes, fileName } = await checkedGlb(form.get("file"));
  const sizeUnits = glbSizeUnits(bytes);
  if (!sizeUnits) throw new ApiFailure(422, "invalid_glb", GLB_MESSAGES.noGeometry, "file");
  const { sizeMm, readAsMm } = unitsToMm(sizeUnits);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = modelKey(org, sha256);

  // 1. The object. Content-addressed, so an existing one is the same bytes; it is written again
  //    only when it is old enough that orphan cleanup might be deciding about it right now.
  const existing = await blob.head(key);
  const fresh = existing && existing.size === bytes.byteLength && Date.now() - existing.lastModified.getTime() < ORPHAN_AGE_MS / 2;
  if (!fresh) await blob.put(key, bytes, { contentType: GLB_CONTENT_TYPE, metadata: { sha256 } });

  // 2. The rows, in one transaction.
  return inTransaction(db, async (repo) => {
    const model = await repo.partModels.put(org, {
      sha256,
      sizeBytes: bytes.byteLength,
      objectKey: key,
      validation: { format: "glb", version: 2, compression: "none", maxBytes: MAX_GLB_BYTES, readAsMm, sizeMm, checkedBy: "api" },
    });
    const part = await repo.parts.create(org, {
      name: fields.data.name ?? nameFromFile(fileName),
      material: fields.data.material ?? null,
      densityKgM3: fields.data.density ?? null,
      massKg: fields.data.mass,
      sizeXMm: sizeMm[0],
      sizeYMm: sizeMm[1],
      sizeZMm: sizeMm[2],
      modelSha256: sha256,
      source: "upload",
    });
    // Last in the transaction (see emitEvent). Org-wide: the part has no job yet.
    await emitEvent(repo, org, { jobId: null, type: "part.created", payload: { partId: part.id } });
    return {
      part: partResponse(part),
      model: { sha256, sizeBytes: bytes.byteLength, readAsMm, created: model.created },
    };
  });
}
