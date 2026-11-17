/**
 * The crate engine's Web Worker (spec §5.1): runs `designShipment` off the render thread
 * for `engineClient.ts`. Started with `new Worker(new URL("./engine.worker.ts", import.meta.url))`,
 * which Next.js bundles as its own chunk; nothing imports this module.
 */
import { designShipment } from "@/engine/engine";
import type { WorkerRequest, WorkerResponse } from "@/engine/schemas";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse): void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, ok: true, output: designShipment(data.request) });
  } catch (e) {
    scope.postMessage({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
