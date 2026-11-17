import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveness, LIVENESS_MAX_DELAY_MS, LIVENESS_MIN_DELAY_MS } from "./liveness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createLiveness", () => {
  it("starts unknown and doesn't probe until something fails", async () => {
    const probe = vi.fn(async () => true);
    const l = createLiveness({ probe });
    expect(l.state).toBe("unknown");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).not.toHaveBeenCalled();
    l.stop();
  });

  it("probes with a doubling backoff capped at the max, and turns reachable on the first success", async () => {
    let up = false;
    const probe = vi.fn(async () => up);
    const states: string[] = [];
    const l = createLiveness({ probe, minDelayMs: 500, maxDelayMs: 3000 });
    l.subscribe((s) => states.push(s));
    l.reportUnreachable();
    expect(l.state).toBe("unreachable");

    const times: number[] = [];
    probe.mockImplementation(async () => {
      times.push(Date.now());
      return up;
    });
    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(20_000);
    const gaps = times.map((t, i) => t - (i ? times[i - 1]! : t0));
    expect(gaps.slice(0, 4)).toEqual([500, 1000, 2000, 3000]);
    expect(Math.max(...gaps)).toBe(3000);

    // The server comes back: noticed within the cap.
    up = true;
    const back = Date.now();
    await vi.advanceTimersByTimeAsync(3000);
    expect(l.state).toBe("reachable");
    expect(states).toEqual(["unreachable", "reachable"]);
    expect(times.at(-1)! - back).toBeLessThanOrEqual(3000);

    // Reachable: no more probes, and the backoff starts over after the next failure.
    const calls = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probe).toHaveBeenCalledTimes(calls);
    up = false;
    l.reportUnreachable();
    await vi.advanceTimersByTimeAsync(500);
    expect(probe).toHaveBeenCalledTimes(calls + 1);
    l.stop();
  });

  it("the defaults find the server within 5 s of it coming back, however long it was away", async () => {
    let up = false;
    const l = createLiveness({ probe: async () => up });
    l.reportUnreachable();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    up = true;
    await vi.advanceTimersByTimeAsync(LIVENESS_MAX_DELAY_MS);
    expect(l.state).toBe("reachable");
    expect(LIVENESS_MIN_DELAY_MS).toBeLessThan(LIVENESS_MAX_DELAY_MS);
    expect(LIVENESS_MAX_DELAY_MS).toBeLessThan(5000);
    l.stop();
  });

  it("an open stream (reportReachable) stops probing at once; repeated failures don't stack probes", async () => {
    const probe = vi.fn(async () => false);
    const l = createLiveness({ probe, minDelayMs: 500, maxDelayMs: 500 });
    l.reportUnreachable();
    l.reportUnreachable();
    l.reportUnreachable();
    await vi.advanceTimersByTimeAsync(500);
    expect(probe).toHaveBeenCalledTimes(1);
    l.reportReachable();
    expect(l.state).toBe("reachable");
    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);
    l.stop();
  });

  it("treats a probe that throws as unreachable, and check() probes now", async () => {
    const probe = vi.fn(async () => {
      throw new Error("boom");
    });
    const l = createLiveness({ probe });
    l.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.state).toBe("unreachable");
    l.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
