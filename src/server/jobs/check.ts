/**
 * The CPU half of the save check (#46 §4, "Results from the browser can't be trusted"): parse the
 * browser's request, run the engine on it and compare the answer with the browser's. Pure and
 * synchronous, so the engine worker threads run it (`verify` task, `engineThread.ts`) and the
 * request thread never does (`verify.ts` sends it there). It imports nothing that touches the
 * network, Next.js or the database, because it is bundled into the thread.
 */
import { canonicalJson } from "@/engine/canonical";
import { designShipment } from "@/engine/engine";
import { type DesignRequest, DesignRequestSchema, type DesignResponse } from "@/engine/schemas";

export type ConfigurationCheckInput = { request: unknown; inputHash: string; summary: unknown };

/**
 * What the save stores. Not the full `DesignResponse`: its plan (boards, cut list) is large, and
 * only these fields cross back from the thread.
 */
export type CheckedDesign = Pick<DesignResponse, "inputHash" | "engineVersion" | "summary">;

export type ConfigurationCheck =
  | { ok: true; request: DesignRequest; design: CheckedDesign }
  | { ok: false; status: 400 | 422; code: "invalid_request" | "result_mismatch"; field: string; message?: string };

export function checkConfiguration(input: ConfigurationCheckInput): ConfigurationCheck {
  const parsed = DesignRequestSchema.safeParse(input.request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, status: 400, code: "invalid_request", field: ["request", ...issue.path].join("."), message: issue.message };
  }
  const request = parsed.data;
  const { inputHash, engineVersion, summary } = designShipment(request);
  if (inputHash !== input.inputHash) return { ok: false, status: 422, code: "result_mismatch", field: "inputHash" };
  let same = false;
  try {
    same = canonicalJson(summary) === canonicalJson(input.summary);
  } catch {
    // Not plain JSON data: can't be the engine's summary.
  }
  if (!same) return { ok: false, status: 422, code: "result_mismatch", field: "summary" };
  if (!summary.crates.length || summary.problem) return { ok: false, status: 422, code: "invalid_request", field: "request" };
  return { ok: true, request, design: { inputHash, engineVersion, summary } };
}
