/**
 * Event-loop lag sampler (#46 load test, docs/LOAD_TEST.md). Every SSE stream, LISTEN fan-out and
 * the save route's engine recompute share one Node event loop per process, so its lag is the
 * first thing to watch under load. `GET /api/v1/health` reports the last completed window.
 *
 * Cheap by design: `monitorEventLoopDelay` is a native histogram fed by a libuv timer (20 ms
 * resolution here; it records the whole interval between ticks, so the resolution is subtracted
 * and an idle loop reads ~0), and once per window we read four numbers from it, reset it, and take one
 * `eventLoopUtilization` delta. Started on the first health check, never at import, so builds and
 * tests don't run timers; the interval is unref'd so it never keeps a process alive.
 */
import { type EventLoopUtilization, monitorEventLoopDelay, performance } from "node:perf_hooks";

export type EventLoopWindow = {
  /** Length of the window these numbers cover. */
  windowMs: number;
  /** Event-loop delay in ms: how late a timer fired. ~0 on an idle loop; a blocking task shows up whole. */
  delayMs: { mean: number; p50: number; p99: number; max: number };
  /** Share of the window the loop was busy (0–1). Near 1 means the process is CPU-bound. */
  utilization: number;
};

/** What the sampler reads from `monitorEventLoopDelay`'s histogram (values in nanoseconds). */
export type DelayHistogram = {
  enable(): boolean;
  disable(): boolean;
  reset(): void;
  readonly mean: number;
  readonly max: number;
  readonly count?: number;
  percentile(p: number): number;
};

export type EventLoopSamplerOptions = {
  windowMs?: number;
  /** The histogram's timer interval, subtracted from its readings. */
  resolutionMs?: number;
  histogram?: DelayHistogram;
  utilization?: (previous?: EventLoopUtilization) => EventLoopUtilization;
};

const EVENT_LOOP_WINDOW_MS = 1000;
const RESOLUTION_MS = 20;
const round2 = (x: number) => Math.round(x * 100) / 100;

export function createEventLoopSampler(options: EventLoopSamplerOptions = {}) {
  const windowMs = options.windowMs ?? EVENT_LOOP_WINDOW_MS;
  const resolutionMs = options.resolutionMs ?? RESOLUTION_MS;
  const histogram = options.histogram ?? monitorEventLoopDelay({ resolution: resolutionMs });
  const ms = (ns: number) => (Number.isFinite(ns) ? Math.max(0, Math.round(ns / 1e4) / 100 - resolutionMs) : 0);
  const utilization = options.utilization ?? ((prev) => performance.eventLoopUtilization(prev));
  let last: EventLoopWindow | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let eluStart: EventLoopUtilization | undefined;

  function rotate(): void {
    const elu = utilization(eluStart);
    last = {
      windowMs,
      delayMs: {
        mean: round2(ms(histogram.mean)),
        p50: round2(ms(histogram.percentile(50))),
        p99: round2(ms(histogram.percentile(99))),
        max: round2(ms(histogram.max)),
      },
      utilization: Math.round(elu.utilization * 1000) / 1000,
    };
    histogram.reset();
    eluStart = utilization();
  }

  return {
    /** Starts sampling (idempotent). */
    start(): void {
      if (timer) return;
      histogram.enable();
      eluStart = utilization();
      timer = setInterval(rotate, windowMs);
      timer.unref?.();
    },
    stop(): void {
      clearInterval(timer);
      timer = undefined;
      histogram.disable();
    },
    /** The last completed window, or null until one has completed. */
    read(): EventLoopWindow | null {
      return last;
    },
    /** For tests: close the current window now. */
    rotate,
  };
}

export type EventLoopSampler = ReturnType<typeof createEventLoopSampler>;

const holder = globalThis as typeof globalThis & { __crateDesignerEventLoop?: EventLoopSampler };

/** The process-wide sampler, started on first use. */
export function getEventLoopSampler(): EventLoopSampler {
  if (!holder.__crateDesignerEventLoop) {
    holder.__crateDesignerEventLoop = createEventLoopSampler();
    holder.__crateDesignerEventLoop.start();
  }
  return holder.__crateDesignerEventLoop;
}
