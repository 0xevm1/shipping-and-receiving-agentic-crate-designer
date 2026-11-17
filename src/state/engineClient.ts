import { designShipment } from "@/engine/engine";
import type { DesignRequest, DesignResponse, WorkerRequest, WorkerResponse } from "@/engine/schemas";

/**
 * The browser's way to the crate engine (spec §5.1). In a page that can start a Web Worker
 * the engine runs there, off the render thread; anywhere else (server rendering, unit tests in
 * Node or jsdom, a browser that refuses the worker) it runs in this thread, synchronously.
 *
 * `design` is latest-wins: one request is in flight at a time, and a newer request replaces one
 * still waiting to be sent. Every request that runs has its `apply` called, in the order sent;
 * a request replaced before it was sent never runs and its `apply` is never called (the caller
 * folds its inputs into the newer one). Without a worker, `apply` is called before `design`
 * returns, which keeps the store synchronous wherever there is no worker.
 */
export interface EngineClient {
  /** Runs the design in this thread, now. */
  designSync(req: DesignRequest): DesignResponse;
  /** Runs the design (in the worker when there is one) and hands its result to `apply`. */
  design(req: DesignRequest, apply: (out: DesignResponse) => void): void;
  /** True while designs run in a worker (false once it failed, or where there is none). */
  readonly inWorker: boolean;
}

/** What the client needs of a `Worker`; tests pass a stand-in. */
export interface WorkerLike {
  postMessage(msg: WorkerRequest): void;
  onmessage: ((e: { data: WorkerResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

/** The engine worker, or null where workers aren't available (no window, no Worker, or it fails to start). */
function browserWorker(): WorkerLike | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "crate-engine" }) as unknown as WorkerLike;
  } catch (e) {
    console.warn("The crate engine worker did not start; designing on the page instead.", e);
    return null;
  }
}

interface Job {
  id: number;
  req: DesignRequest;
  apply: (out: DesignResponse) => void;
}

export function createEngineClient(makeWorker: () => WorkerLike | null = browserWorker): EngineClient {
  // Started on the first `design` call, so importing the store starts nothing.
  let worker: WorkerLike | null | undefined;
  let ids = 0;
  let inFlight: Job | null = null;
  let queued: Job | null = null;

  const local = (job: Job) => job.apply(designShipment(job.req));

  /** Gives up on the worker: the job in flight and the one waiting run here instead. */
  const fail = (why: unknown) => {
    console.warn("The crate engine worker failed; designing on the page instead.", why);
    worker?.terminate();
    worker = null;
    const pending = [inFlight, queued].filter((j): j is Job => j !== null);
    inFlight = queued = null;
    pending.forEach(local);
  };

  const send = (job: Job) => {
    inFlight = job;
    try {
      worker!.postMessage({ id: job.id, op: "design", request: job.req });
    } catch (e) {
      // DataCloneError and the like: this request can't cross, so nothing will.
      fail(e);
    }
  };

  const start = (): WorkerLike | null => {
    if (worker !== undefined) return worker;
    worker = makeWorker();
    if (worker) {
      worker.onmessage = ({ data }) => {
        const job = inFlight;
        if (!job || data.id !== job.id) return;
        if (!data.ok) return fail(new Error(data.error));
        inFlight = null;
        job.apply(data.output);
        const next = queued;
        queued = null;
        if (next && worker) send(next);
        else if (next) local(next);
      };
      worker.onerror = (e) => fail(e);
    }
    return worker;
  };

  return {
    designSync: designShipment,
    design(req, apply) {
      const job = { id: ++ids, req, apply };
      if (!start()) return local(job);
      if (inFlight) queued = job;
      else send(job);
    },
    get inWorker() {
      return !!worker;
    },
  };
}

/** The app's engine client. */
export const engine = createEngineClient();
