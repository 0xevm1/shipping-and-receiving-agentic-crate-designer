/**
 * `POST /api/v1/designs` (#46 slice 7): a stateless, headless calculation. A GLB and the part's
 * facts in, the ranked configurations out; nothing is saved. The upload gets the same checks and
 * messages as `POST /api/v1/parts` (`checkedGlb`), and the engine work (sweep plus the shortlist's
 * designs) runs on the worker pool, never on the request thread.
 */
import { createHash } from "node:crypto";
import { GLB_MESSAGES, glbSizeUnits, idFromFile, nameFromFile, unitsToMm } from "@/domain/glb";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { DEFAULT_SWEEP_RULES, type SweepRequest } from "@/engine/sweep";
import { type DesignsApiResponse, DesignsFieldsSchema } from "@/lib/api/designs";
import { ApiFailure } from "../http";
import { checkedGlb, readForm } from "../parts/create";
import type { EnginePool } from "../workers/pool";

export async function calculateDesigns(request: Request, { pool }: { pool: Pick<EnginePool, "run"> }): Promise<DesignsApiResponse> {
  const form = await readForm(request);
  const fields = DesignsFieldsSchema.safeParse({
    mass: form.get("mass"),
    material: form.get("material"),
    density: form.get("density"),
    name: form.get("name"),
    total: form.get("total"),
    freightRates: form.get("freightRates"),
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
  const { mass, material, name, total, freightRates } = fields.data;

  const req: SweepRequest = {
    part: { id: idFromFile(fileName), name: name ?? nameFromFile(fileName), mass_kg: mass, dimensions_mm: sizeMm, material },
    rules: DEFAULT_SWEEP_RULES,
    standards: DEFAULT_STANDARDS,
    freightRates: freightRates ?? null,
    total: total ?? null,
  };
  const report = await pool.run("designs", req);
  return { ...report, model: { sha256, sizeBytes: bytes.byteLength, readAsMm } };
}
