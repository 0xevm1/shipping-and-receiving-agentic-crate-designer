/**
 * Is the server reachable right now? (#46 slice 7a, docs/API.md "Offline")
 *
 * Not `navigator.onLine`, which only says a network exists: the dock's Wi-Fi can be up while the
 * server or its database is down. The server is reachable when its event stream is open
 * (`reportReachable`, from the EventSource's `onopen`) or when `GET /api/v1/health` answers 200
 * (the `probe`). Anything that fails to reach it (a dropped stream, a request that came back
 * `offline`) calls `reportUnreachable`, and from then on the probe runs with a backoff from
 * `minDelayMs`, doubling, capped at `maxDelayMs`, until it succeeds. The cap is what bounds the
 * time to notice the server is back: with the defaults, at most 3 s plus one probe.
 */

export type LivenessState = "unknown" | "reachable" | "unreachable";

export type LivenessOptions = {
  /** Resolves true when the server answers (`GET /api/v1/health` is 200). Must not throw; a throw counts as false. */
  probe: () => Promise<boolean>;
  /** First wait before probing after a failure. */
  minDelayMs?: number;
  /** Longest wait between probes. Keep it under the 5 s the offline queue promises. */
  maxDelayMs?: number;
};

export type Liveness = {
  readonly state: LivenessState;
  /** Called on every change of state (not on repeats). Returns a function that unsubscribes. */
  subscribe(listener: (state: LivenessState) => void): () => void;
  /** The server answered (the stream opened, a request succeeded). Stops probing. */
  reportReachable(): void;
  /** The server didn't answer. Starts probing, if it isn't already. */
  reportUnreachable(): void;
  /** Probe now (e.g. on page load), whatever the state. */
  check(): void;
  stop(): void;
};

export const LIVENESS_MIN_DELAY_MS = 500;
export const LIVENESS_MAX_DELAY_MS = 3000;

export function createLiveness(options: LivenessOptions): Liveness {
  const { probe, minDelayMs = LIVENESS_MIN_DELAY_MS, maxDelayMs = LIVENESS_MAX_DELAY_MS } = options;
  const listeners = new Set<(s: LivenessState) => void>();
  let state: LivenessState = "unknown";
  let delay = minDelayMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let probing = false;
  let stopped = false;

  function set(next: LivenessState) {
    if (next === state) return;
    state = next;
    for (const l of [...listeners]) l(next);
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void runProbe();
    }, delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }

  async function runProbe() {
    if (stopped || probing) return;
    probing = true;
    let ok = false;
    try {
      ok = await probe();
    } catch {
      ok = false;
    }
    probing = false;
    if (stopped) return;
    if (ok) {
      reportReachable();
    } else {
      set("unreachable");
      schedule();
    }
  }

  function reportReachable() {
    if (stopped) return;
    clearTimeout(timer);
    timer = undefined;
    delay = minDelayMs;
    set("reachable");
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reportReachable,
    reportUnreachable() {
      if (stopped) return;
      set("unreachable");
      if (timer === undefined && !probing) schedule();
    },
    check() {
      if (stopped) return;
      clearTimeout(timer);
      timer = undefined;
      void runProbe();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
