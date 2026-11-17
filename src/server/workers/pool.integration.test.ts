// The engine worker pool with the real engine thread bundle (#46 slice 7). The acceptance check:
// a server-side sweep doesn't stall the thread that serves requests and SSE streams (event-loop
// lag stays under 50 ms during a full sweep). No database needed; it lives with the integration
// tests because it needs `bun run engine:build` (their globalSetup runs it).
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { rankConfigurations, runSweep, DEFAULT_SWEEP_RULES, type SweepRequest } from "@/engine/sweep";
import { createEnginePool } from "./engine";
import type { EnginePool } from "./pool";

const MAX_LAG_MS = 50;
let pool: EnginePool;

beforeAll(async () => {
  pool = createEnginePool(undefined, 2);
  // Start the threads (and load the engine in them) before measuring.
  await Promise.all([1, 2].map(() => pool.run("sweep", { ...request("PART-001"), maxQuantity: 2 })));
});
afterAll(() => pool?.close());

const request = (id: string, total: number | null = null): SweepRequest => ({
  part: getPart(id),
  rules: DEFAULT_SWEEP_RULES,
  standards: DEFAULT_STANDARDS,
  total,
});

/** Runs `work` while sampling this thread's event-loop delay; returns the worst delay seen, in ms. */
async function worstLag<T>(work: () => Promise<T>): Promise<{ lagMs: number; result: T }> {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  // A timer that should fire every 5 ms: how late it runs is the lag a request or SSE write would see.
  let last = performance.now();
  let worst = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last - 5);
    last = now;
  }, 5);
  try {
    const result = await work();
    return { lagMs: Math.max(worst, histogram.max / 1e6 - 5), result };
  } finally {
    clearInterval(tick);
    histogram.disable();
  }
}

describe("engine worker pool", () => {
  it(`keeps the main thread's event-loop lag under ${MAX_LAG_MS} ms during full sweeps`, async () => {
    const started = performance.now();
    const { lagMs, result } = await worstLag(() => Promise.all(["PART-001", "PART-002", "PART-003"].map((id) => pool.run("designs", request(id, 40)))));
    const elapsed = performance.now() - started;
    expect(result.every((r) => r.curve.length === 200)).toBe(true);
    // The work itself takes far longer than the lag allowance: it really ran elsewhere.
    expect(elapsed).toBeGreaterThan(MAX_LAG_MS);
    expect(lagMs).toBeLessThan(MAX_LAG_MS);
  });

  it("gives exactly the answer the engine gives in this thread", async () => {
    const req = request("PART-002", 25);
    expect(await pool.run("designs", req)).toEqual(rankConfigurations(req));
    expect(await pool.run("sweep", req)).toEqual(runSweep(req));
  });
});
