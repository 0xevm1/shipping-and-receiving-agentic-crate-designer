/**
 * `POST /api/v1/designs` (#46 slice 7): a stateless, headless calculation. A GLB and the part's
 * facts in, the ranked configurations out; nothing is saved. The upload gets the same checks and
 * messages as `POST /api/v1/parts` (`checkedGlb`), and the engine work (sweep plus the shortlist's
 * designs) runs on the worker pool, never on the request thread. `standards` are the caller's org's
 * (`readOrgStandards`), the shipped defaults when not given.
 */
import { createHash } from "node:crypto";
import { idFromFile, nameFromFile } from "@/domain/glb";
import { readFrame } from "@/domain/partFrame";
import { DEFAULT_STANDARDS, type ShopStandards } from "@/domain/standards";
import { sweepRequestFor } from "@/engine/request";
import { DEFAULT_SWEEP_RULES } from "@/engine/sweep";
import { type DesignsApiResponse, DesignsFieldsSchema } from "@/lib/api/designs";
import { ApiFailure } from "../http";
import { checkedGlb, readForm } from "../parts/create";
import type { EnginePool } from "../workers/pool";

export async function calculateDesigns(
  request: Request,
  { pool, standards = DEFAULT_STANDARDS }: { pool: Pick<EnginePool, "run">; standards?: ShopStandards },
): Promise<DesignsApiResponse> {
  const form = await readForm(request);
  const fields = DesignsFieldsSchema.safeParse({
    mass: form.get("mass"),
    material: form.get("material"),
    density: form.get("density"),
    name: form.get("name"),
    units: form.get("units"),
    up: form.get("up"),
    total: form.get("total"),
    freightRates: form.get("freightRates"),
  });
  if (!fields.success) {
    const issue = fields.error.issues[0]!;
    throw new ApiFailure(400, "invalid_request", issue.message, issue.path.join("."));
  }
  const { bytes, fileName, sizeUnits } = await checkedGlb(form.get("file"));
  const { mass, material, name, total, freightRates, units, up } = fields.data;
  const { frame, guessed, sizeMm } = readFrame(sizeUnits, { units, up });
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const req = sweepRequestFor({
    part: { id: idFromFile(fileName), name: name ?? nameFromFile(fileName), mass_kg: mass, dimensions_mm: sizeMm, material },
    rules: DEFAULT_SWEEP_RULES,
    standards,
    freightRates: freightRates ?? null,
    total: total ?? null,
  });
  const report = await pool.run("designs", req);
  return { ...report, model: { sha256, sizeBytes: bytes.byteLength, readAsMm: frame.units === "mm", units: frame.units, up: frame.up, unitsGuessed: guessed } };
}
