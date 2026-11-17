/**
 * A part's GLB for the browser (#46): `GET /api/v1/parts/:id/model`. Looked up by part id within
 * the caller's org, never by hash alone, and answered with a short-lived presigned URL so the bytes
 * skip Next.js.
 */
import type { ModelUrlResponse } from "@/lib/api/parts";
import { modelKey } from "../blob/keys";
import { PRESIGN_SECONDS } from "../blob/store";
import { createRepository } from "../db/repository";
import { ApiFailure } from "../http";
import { idFromFile } from "@/domain/glb";
import type { PartsDeps } from "./create";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "There is no model for that part.";

export async function partModelUrl(partId: string, { db, blob, org }: PartsDeps): Promise<ModelUrlResponse> {
  if (!UUID.test(partId)) throw new ApiFailure(404, "not_found", NOT_FOUND);
  const repo = createRepository(db);
  const part = await repo.parts.get(org, partId);
  if (!part?.modelSha256) throw new ApiFailure(404, "not_found", NOT_FOUND);
  const model = await repo.partModels.get(org, part.modelSha256);
  if (!model) throw new ApiFailure(404, "not_found", NOT_FOUND);
  const { url, expiresAt } = await blob.presignGet(modelKey(org, model.sha256), {
    expiresInSeconds: PRESIGN_SECONDS,
    downloadName: `${idFromFile(part.name)}.glb`,
  });
  return { url, expiresAt: expiresAt.toISOString(), sha256: model.sha256, sizeBytes: model.sizeBytes };
}
