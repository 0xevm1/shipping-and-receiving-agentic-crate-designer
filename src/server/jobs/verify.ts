/**
 * Server-side check of a configuration made in the browser (#46 §4, "Results from the browser
 * can't be trusted"). The server runs the same engine on the same request and stores the
 * configuration only when its answer is the browser's: same engine version, same `inputHash`,
 * same summary (compared as canonical JSON, so key order and -0 don't matter).
 *
 * The engine run (~15 ms of CPU) goes to the engine worker pool (`check`, normally
 * `pool.run("verify", …)`), never the request thread, and the save calls this before it opens its
 * transaction, so no pool connection waits on the engine.
 */
import { ENGINE_VERSION } from "@/engine/version";
import type { SaveConfigurationRequest } from "@/lib/api/jobs";
import { ApiFailure } from "../http";
import type { CheckedDesign, ConfigurationCheck, ConfigurationCheckInput } from "./check";
import type { DesignRequest } from "@/engine/schemas";

export type Verified = { request: DesignRequest; design: CheckedDesign };

/** Runs `checkConfiguration` somewhere off the request thread (the engine worker pool). */
export type RunCheck = (input: ConfigurationCheckInput) => Promise<ConfigurationCheck>;

export const ENGINE_MISMATCH_MESSAGE = "This tab runs an older version of the crate designer. Reload the page, then save again.";
export const RESULT_MISMATCH_MESSAGE = "The server worked this design out differently, so it wasn't saved. Reload the page and try again.";
const NO_CRATE_MESSAGE = "There is no crate to save for these settings.";

export async function verifyConfiguration(body: SaveConfigurationRequest, check: RunCheck, engineVersion = ENGINE_VERSION): Promise<Verified> {
  // Cheap, so before anything is sent to a thread.
  if (body.engineVersion !== engineVersion) {
    throw new ApiFailure(409, "engine_version_mismatch", ENGINE_MISMATCH_MESSAGE, "engineVersion", { engineVersion });
  }
  const result = await check({ request: body.request, inputHash: body.inputHash, summary: body.summary });
  if (result.ok) return { request: result.request, design: result.design };
  if (result.code === "result_mismatch") throw new ApiFailure(422, "result_mismatch", RESULT_MISMATCH_MESSAGE, result.field);
  if (result.status === 400) throw new ApiFailure(400, "invalid_request", `The design request isn't valid: ${result.message}`, result.field);
  throw new ApiFailure(422, "invalid_request", NO_CRATE_MESSAGE, result.field);
}
