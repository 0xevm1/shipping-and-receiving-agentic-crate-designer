/**
 * Wall-clock checks for tests that can't flake under load (#48). Not imported by the app.
 *
 * A real performance regression is a 10× event, not 2×, so budgets are generous; a median ignores
 * one run stalled by GC or a busy machine; and the budget grows with the machine's load.
 */

/**
 * A wall-clock budget that follows machine load. A fixed CPU loop takes about 3.5 ms on an idle
 * laptop; when the machine is busy it takes proportionally longer, and so does the code under
 * test. The budget is `ms` or `ratio` loop-times, whichever is larger, so it is never tighter than
 * `ms` and a 10x regression still fails when the machine is idle.
 */
export function loadAwareBudget(ms: number, ratio: number): number {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    let x = 0;
    for (let n = 0; n < 3e6; n++) x += Math.sqrt(n);
    if (x < 0) throw new Error("unreachable: keeps the loop from being optimised away");
    times.push(performance.now() - t0);
  }
  return Math.max(ms, ratio * times.sort((a, b) => a - b)[2]!);
}

const TIMING_RUNS = 5;

/** The median of `times`. */
export const median = (times: number[]): number => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]!;

/** Median wall time of `TIMING_RUNS` calls, robust to a few runs slowed by GC or CPU load. */
export function medianMs(fn: () => unknown): number {
  const times: number[] = [];
  for (let i = 0; i < TIMING_RUNS; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return median(times);
}
