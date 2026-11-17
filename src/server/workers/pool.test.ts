// The worker pool with stand-in threads (eval'd JS), so no engine bundle is needed here.
// The real engine thread and the event-loop lag are in pool.integration.test.ts.
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerPool, type EnginePool, PoolClosedError } from "./pool";

/** Answers `{ id, kind, input: { ms, value, crash } }` after `ms`, echoing `value` (or failing). */
const STAND_IN = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({ id, input }) => {
  if (input.crash) process.exit(3);
  const end = Date.now() + (input.ms ?? 0);
  while (Date.now() < end) {}
  if (input.error) parentPort.postMessage({ id, ok: false, error: input.error });
  else parentPort.postMessage({ id, ok: true, output: { value: input.value, thread: require("node:worker_threads").threadId } });
});`;

let pool: EnginePool | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

type Out = { value: unknown; thread: number };
const run = (p: EnginePool, input: Record<string, unknown>) => p.run("sweep", input as never) as unknown as Promise<Out>;

describe("worker pool", () => {
  it("runs tasks in threads, at most `size` at once, the rest in order", async () => {
    let spawned = 0;
    pool = createWorkerPool({ size: 2, spawn: () => (spawned++, new Worker(STAND_IN, { eval: true })) });
    const outs = await Promise.all([1, 2, 3, 4, 5].map((value) => run(pool!, { ms: 30, value })));
    expect(outs.map((o) => o.value)).toEqual([1, 2, 3, 4, 5]);
    expect(spawned).toBe(2);
    expect(new Set(outs.map((o) => o.thread)).size).toBe(2);
    expect(pool.stats()).toEqual({ threads: 2, busy: 0, waiting: 0 });
  });

  it("passes a task's error back without losing the thread", async () => {
    pool = createWorkerPool({ size: 1, spawn: () => new Worker(STAND_IN, { eval: true }) });
    await expect(run(pool, { error: "no crate" })).rejects.toThrow("no crate");
    expect((await run(pool, { value: "ok" })).value).toBe("ok");
    expect(pool.stats().threads).toBe(1);
  });

  it("fails only the crashed thread's task, and replaces the thread", async () => {
    pool = createWorkerPool({ size: 1, spawn: () => new Worker(STAND_IN, { eval: true }) });
    const crashed = run(pool, { crash: true });
    const next = run(pool, { value: "after" });
    await expect(crashed).rejects.toThrow(/exited/);
    expect((await next).value).toBe("after");
  });

  it("terminates a thread whose task runs over the time limit", async () => {
    pool = createWorkerPool({ size: 1, timeoutMs: 100, spawn: () => new Worker(STAND_IN, { eval: true }) });
    await expect(run(pool, { ms: 2_000 })).rejects.toThrow(/longer than 100 ms/);
    expect((await run(pool, { value: 1 })).value).toBe(1);
  });

  it("refuses work once closed, and fails what was waiting", async () => {
    pool = createWorkerPool({ size: 1, spawn: () => new Worker(STAND_IN, { eval: true }) });
    const running = expect(run(pool, { ms: 200 })).rejects.toBeInstanceOf(PoolClosedError);
    const waiting = expect(run(pool, { value: 2 })).rejects.toBeInstanceOf(PoolClosedError);
    await pool.close();
    await running;
    await waiting;
    await expect(run(pool, { value: 3 })).rejects.toBeInstanceOf(PoolClosedError);
  });
});
