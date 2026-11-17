/**
 * Server-side check of a configuration made in the browser (#46 §4, "Results from the browser
 * can't be trusted"). The server runs the same engine on the same request and stores the
 * configuration only when its answer is the browser's: same engine version, same `inputHash`,
 * same summary (compared as canonical JSON, so key order and -0 don't matter).
 */
import { canonicalJson } from "@/engine/canonical";
import { designShipment } from "@/engine/engine";
import { type DesignRequest, DesignRequestSchema, type DesignResponse } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import type { SaveConfigurationRequest } from "@/lib/api/jobs";
import { ApiFailure } from "../http";

export type Verified = { request: DesignRequest; design: DesignResponse };

export const ENGINE_MISMATCH_MESSAGE = "This tab runs an older version of the crate designer. Reload the page, then save again.";
export const RESULT_MISMATCH_MESSAGE = "The server worked this design out differently, so it wasn't saved. Reload the page and try again.";

export function verifyConfiguration(body: SaveConfigurationRequest, engineVersion = ENGINE_VERSION): Verified {
  if (body.engineVersion !== engineVersion) {
    throw new ApiFailure(409, "engine_version_mismatch", ENGINE_MISMATCH_MESSAGE, "engineVersion", { engineVersion });
  }
  const parsed = DesignRequestSchema.safeParse(body.request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ApiFailure(400, "invalid_request", `The design request isn't valid: ${issue.message}`, ["request", ...issue.path].join("."));
  }
  const request = parsed.data;
  const design = designShipment(request);
  if (design.inputHash !== body.inputHash) throw new ApiFailure(422, "result_mismatch", RESULT_MISMATCH_MESSAGE, "inputHash");
  let same = false;
  try {
    same = canonicalJson(design.summary) === canonicalJson(body.summary);
  } catch {
    // Not plain JSON data: can't be the engine's summary.
  }
  if (!same) throw new ApiFailure(422, "result_mismatch", RESULT_MISMATCH_MESSAGE, "summary");
  if (!design.summary.crates.length || design.summary.problem) {
    throw new ApiFailure(422, "invalid_request", "There is no crate to save for these settings.", "request");
  }
  return { request, design };
}
