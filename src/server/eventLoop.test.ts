import type { EventLoopUtilization } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createEventLoopSampler, type DelayHistogram } from "./eventLoop";
import { checkHealth } from "./health";

function fakeHistogram(ns: { mean: number; p50: number; p99: number; max: number }) {
  const state = { resets: 0, enabled: false };
  const h: DelayHistogram = {
    enable: () => (state.enabled = true),
    disable: () => !(state.enabled = false),
    reset: () => void state.resets++,
    mean: ns.mean,
    max: ns.max,
    percentile: (p) => (p === 50 ? ns.p50 : ns.p99),
  };
  return { h, state };
}

const elu = (utilization: number) => () => ({ idle: 0, active: 0, utilization }) as EventLoopUtilization;

describe("event-loop sampler", () => {
  it("reports nothing until a window completes, then that window in ms past the timer interval, and resets the histogram", () => {
    const { h, state } = fakeHistogram({ mean: 21_000_000, p50: 20_000_000, p99: 35_500_000, max: 120_250_000 });
    const sampler = createEventLoopSampler({ histogram: h, utilization: elu(0.4567), windowMs: 1000, resolutionMs: 20 });
    sampler.start();
    expect(state.enabled).toBe(true);
    expect(sampler.read()).toBeNull();
    sampler.rotate();
    expect(sampler.read()).toEqual({ windowMs: 1000, delayMs: { mean: 1, p50: 0, p99: 15.5, max: 100.25 }, utilization: 0.457 });
    expect(state.resets).toBe(1);
    sampler.stop();
    expect(state.enabled).toBe(false);
  });

  it("is part of the health check, also when the database is down", async () => {
    const { h } = fakeHistogram({ mean: 1e6, p50: 1e6, p99: 2e6, max: 3e6 });
    const sampler = createEventLoopSampler({ histogram: h, utilization: elu(0.1), resolutionMs: 0 });
    sampler.rotate();
    const up = await checkHealth({ ping: async () => {}, notificationQueueUsage: async () => 0 }, undefined, sampler);
    expect(up.eventLoop?.delayMs.p99).toBe(2);
    const down = await checkHealth({ ping: () => Promise.reject(new Error("down")), notificationQueueUsage: async () => 0 }, undefined, sampler);
    expect(down).toMatchObject({ ok: false, eventLoop: { utilization: 0.1 } });
  });
});
