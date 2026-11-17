import { designShipment } from "@/engine/engine";
import { runWorkerRequest } from "@/engine/run";
import type { DesignRequest, DesignResponse, WorkerOp, WorkerOps, WorkerRequest, WorkerResponse } from "@/engine/schemas";
import type { SweepRequest, SweepResponse } from "@/engine/sweep";

/**
 * The browser's way to the crate engine (spec §5.1). In a page that can start a Web Worker
 * the engine runs there, off the render thread; anywhere else (server rendering, unit tests in
 * Node or jsdom, a browser that refuses the worker) it runs in this thread, synchronously.
 *
 * `design` and `sweep` are latest-wins, each on its own lane: one request is in flight at a time, and a newer request replaces one
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
  /**
   * Runs the quantity sweep (spec §7.16) the same way: in the worker when there is one,
   * latest-wins on a lane of its own, so a sweep never delays a design waiting behind it.
   */
  sweep(req: SweepRequest, apply: (out: SweepResponse) => void): void;
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

type Job = { [K in WorkerOp]: { id: number; op: K; req: WorkerOps[K]["request"]; apply: (out: WorkerOps[K]["output"]) => void } }[WorkerOp];

/** One latest-wins queue per op: at most one request in flight and one waiting. */
interface Lane {
  inFlight: Job | null;
  queued: Job | null;
}

/** Runs a job in this thread, now. */
function local(job: Job): void {
  const res = runWorkerRequest({ id: job.id, op: job.op, request: job.req } as WorkerRequest);
  if (!res.ok) throw new Error(res.error);
  (job.apply as (out: unknown) => void)(res.output);
}

export function createEngineClient(makeWorker: () => WorkerLike | null = browserWorker): EngineClient {
  // Started on the first call, so importing the store starts nothing.
  let worker: WorkerLike | null | undefined;
  let ids = 0;
  const lanes: Record<WorkerOp, Lane> = { design: { inFlight: null, queued: null }, sweep: { inFlight: null, queued: null } };
  const laneOf = (id: number): Lane | undefined => Object.values(lanes).find((l) => l.inFlight?.id === id);

  /** Gives up on the worker: the jobs in flight and waiting run here instead. */
  const fail = (why: unknown) => {
    console.warn("The crate engine worker failed; designing on the page instead.", why);
    worker?.terminate();
    worker = null;
    const pending = Object.values(lanes).flatMap((l) => {
      const jobs = [l.inFlight, l.queued].filter((j): j is Job => j !== null);
      l.inFlight = l.queued = null;
      return jobs;
    });
    pending.forEach(local);
  };

  const send = (lane: Lane, job: Job) => {
    lane.inFlight = job;
    try {
      worker!.postMessage({ id: job.id, op: job.op, request: job.req } as WorkerRequest);
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
        const lane = laneOf(data.id);
        const job = lane?.inFlight;
        if (!lane || !job) return;
        if (!data.ok) return fail(new Error(data.error));
        lane.inFlight = null;
        (job.apply as (out: unknown) => void)(data.output);
        const next = lane.queued;
        lane.queued = null;
        if (next && worker) send(lane, next);
        else if (next) local(next);
      };
      worker.onerror = (e) => fail(e);
    }
    return worker;
  };

  const submit = (job: Job) => {
    if (!start()) return local(job);
    const lane = lanes[job.op];
    if (lane.inFlight) lane.queued = job;
    else send(lane, job);
  };

  return {
    designSync: designShipment,
    design(req, apply) {
      submit({ id: ++ids, op: "design", req, apply });
    },
    sweep(req, apply) {
      submit({ id: ++ids, op: "sweep", req, apply });
    },
    get inWorker() {
      return !!worker;
    },
  };
}

/** The app's engine client. */
export const engine = createEngineClient();
