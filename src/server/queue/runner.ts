/**
 * The queue worker loop (#46 slice 7, docs/QUEUE.md). Claims due jobs (`FOR UPDATE SKIP LOCKED`),
 * runs each kind's handler under the job's org, and records the outcome:
 *
 * - **Wake-up:** `NOTIFY crate_jobs` (sent by `enqueue` on commit) wakes idle loops at once; a poll
 *   every `pollIntervalMs` covers a missed or dropped notification, so LISTEN is an optimisation,
 *   never a requirement.
 * - **Leases:** a claim leases the job for `leaseMs`, renewed every third of that while the handler
 *   runs. A worker that crashes stops renewing; once the lease runs out another worker claims the
 *   job again (the attempt counts). If its lease is lost, the handler's `signal` aborts and its
 *   outcome is discarded (`complete`/`fail` only apply to the worker holding the lease).
 * - **Retries:** a thrown error retries with exponential backoff until `max_attempts`; a
 *   `PermanentJobError` (bad payload, missing row) goes straight to `dead`. `onDead` runs once a
 *   job is dead-lettered (the sweep job emits `job.error` there).
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { type OrgContext, orgContext } from "../db/org";
import type { QueueJob, QueueStore } from "../db/queue";

export interface JobContext {
  /** The org the job was enqueued for: every query the handler makes uses it. */
  org: OrgContext;
  job: QueueJob;
  /** Aborted when this worker loses the job's lease (or the runner stops). */
  signal: AbortSignal;
}

/** Runs one job; the resolved value is stored as the job's `result` (keep it small). */
export type JobHandler = (ctx: JobContext) => Promise<unknown>;

/** An error retrying can't fix: the job goes to `dead` at once. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Subscribes `onWake` to new-job notifications; resolves to the unsubscribe function. */
export type QueueListen = (onWake: () => void) => Promise<() => Promise<void>>;

export interface QueueRunnerOptions {
  store: QueueStore;
  handlers: Readonly<Record<string, JobHandler>>;
  /** After a job is dead-lettered. Errors here are logged, never retried. */
  onDead?: (job: QueueJob, error: string) => Promise<void>;
  listen?: QueueListen;
  workerId?: string;
  /** Jobs run at once by this runner. */
  concurrency?: number;
  pollIntervalMs?: number;
  leaseMs?: number;
  backoff?: { baseMs: number; maxMs: number };
  log?: Pick<Console, "info" | "warn" | "error">;
}

export interface QueueRunner {
  readonly workerId: string;
  start(): Promise<void>;
  /** Stops claiming and waits for the jobs running now. */
  stop(): Promise<void>;
  /** Claims and runs one job if one is due (tests, scripts). True when it ran one. */
  runOnce(): Promise<boolean>;
}

export function createQueueRunner(options: QueueRunnerOptions): QueueRunner {
  const {
    store,
    handlers,
    onDead,
    listen,
    workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
    concurrency = 1,
    pollIntervalMs = 5_000,
    leaseMs = 60_000,
    backoff,
    log = console,
  } = options;
  const kinds = Object.keys(handlers);

  let running = false;
  let loops: Promise<void>[] = [];
  let unlisten: (() => Promise<void>) | undefined;
  const sleepers = new Set<() => void>();
  const stopping = new AbortController();

  const wakeAll = () => {
    for (const wake of [...sleepers]) wake();
  };

  /** Resolves on a NOTIFY, after `ms`, or when the runner stops. */
  const nap = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      sleepers.add(done);
    });

  async function deadLetter(job: QueueJob, error: string) {
    try {
      await onDead?.(job, error);
    } catch (e) {
      log.error(`[queue] onDead for ${job.kind} ${job.id} failed:`, e);
    }
  }

  async function runJob(job: QueueJob): Promise<void> {
    if (job.attempts > job.maxAttempts) {
      const error = `Gave up after ${job.maxAttempts} attempts (the last worker stopped renewing its lease).`;
      if ((await store.fail(job.id, workerId, error, { permanent: true })) === "dead") await deadLetter(job, error);
      return;
    }
    const handler = handlers[job.kind];
    const lease = new AbortController();
    const onStop = () => lease.abort(new Error("The queue runner stopped."));
    stopping.signal.addEventListener("abort", onStop);
    const renew = setInterval(
      () =>
        void store.extend(job.id, workerId, leaseMs).then(
          (ok) => ok || lease.abort(new Error("Lease lost.")),
          (e: Error) => log.warn(`[queue] lease renewal for ${job.id} failed: ${e.message}`),
        ),
      Math.max(50, Math.floor(leaseMs / 3)),
    );
    try {
      if (!handler) throw new PermanentJobError(`No handler for job kind "${job.kind}".`);
      const result = await handler({ org: orgContext(job.orgId), job, signal: lease.signal });
      if (!(await store.complete(job.id, workerId, result))) log.warn(`[queue] ${job.kind} ${job.id} finished after its lease was lost; result dropped`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const status = await store.fail(job.id, workerId, error, { permanent: e instanceof PermanentJobError, backoff });
      if (status === "dead") {
        log.error(`[queue] ${job.kind} ${job.id} dead after ${job.attempts} attempt(s): ${error}`);
        await deadLetter(job, error);
      } else if (status === "queued") {
        log.warn(`[queue] ${job.kind} ${job.id} attempt ${job.attempts} failed, will retry: ${error}`);
      }
    } finally {
      clearInterval(renew);
      stopping.signal.removeEventListener("abort", onStop);
    }
  }

  async function runOnce(): Promise<boolean> {
    const job = await store.claim(workerId, leaseMs, kinds);
    if (!job) return false;
    await runJob(job);
    return true;
  }

  async function loop(): Promise<void> {
    while (running) {
      let ran = false;
      try {
        ran = await runOnce();
      } catch (e) {
        log.error("[queue] claim failed:", e);
      }
      if (!ran && running) await nap(pollIntervalMs);
    }
  }

  return {
    workerId,
    runOnce,
    async start() {
      if (running) return;
      running = true;
      if (listen) {
        try {
          unlisten = await listen(wakeAll);
        } catch (e) {
          log.warn(`[queue] LISTEN failed, polling every ${pollIntervalMs} ms only: ${(e as Error).message}`);
        }
      }
      loops = Array.from({ length: Math.max(1, concurrency) }, loop);
    },
    async stop() {
      running = false;
      wakeAll();
      await Promise.all(loops);
      stopping.abort();
      loops = [];
      await unlisten?.().catch(() => {});
      unlisten = undefined;
    },
  };
}
