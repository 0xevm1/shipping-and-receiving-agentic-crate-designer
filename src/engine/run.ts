import { designShipment } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./schemas";
import { runSweep } from "./sweep";

/**
 * Runs one worker message's call (spec §5.1): what the browser's engine worker and its test
 * stand-in do with each request, so the two can't drift.
 */
export function runWorkerRequest(msg: WorkerRequest): WorkerResponse {
  try {
    const output = msg.op === "sweep" ? runSweep(msg.request) : designShipment(msg.request);
    return { id: msg.id, ok: true, output };
  } catch (e) {
    return { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
