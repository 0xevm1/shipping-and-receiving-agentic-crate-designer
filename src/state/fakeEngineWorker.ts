import { designShipment } from "@/engine/engine";
import type { WorkerRequest, WorkerResponse } from "@/engine/schemas";
import type { WorkerLike } from "./engineClient";

/**
 * A stand-in for the engine's Web Worker, for tests: requests wait until `flush()` (or
 * `fail()`), then run the real engine on a structured clone, as a worker would. Node and jsdom
 * have no `Worker`.
 */
export class FakeEngineWorker implements WorkerLike {
  onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  inbox: WorkerRequest[] = [];
  terminated = false;

  postMessage(msg: WorkerRequest) {
    this.inbox.push(structuredClone(msg));
  }

  /** Answers every waiting request, in order (each answer may send the next). */
  flush() {
    while (this.inbox.length) {
      const { id, request } = this.inbox.shift()!;
      this.onmessage?.({ data: structuredClone({ id, ok: true, output: designShipment(request) }) });
    }
  }

  /** The worker crashes. */
  fail() {
    this.onerror?.(new Error("worker crashed"));
  }

  terminate() {
    this.terminated = true;
  }
}
