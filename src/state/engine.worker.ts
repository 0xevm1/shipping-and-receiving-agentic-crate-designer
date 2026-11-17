/**
 * The crate engine's Web Worker (spec §5.1): runs designs and quantity sweeps off the render
 * thread for `engineClient.ts`. Started with `new Worker(new URL("./engine.worker.ts", import.meta.url))`,
 * which Next.js bundles as its own chunk; nothing imports this module.
 */
import { runWorkerRequest } from "@/engine/run";
import type { WorkerRequest, WorkerResponse } from "@/engine/schemas";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse): void;
};

scope.onmessage = ({ data }) => scope.postMessage(runWorkerRequest(data));
