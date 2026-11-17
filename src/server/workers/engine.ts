/**
 * The process's engine worker pool (#46 slice 7). Server-only code calls `getEnginePool().run(…)`
 * for any engine work (a sweep, a design, a bundle): it runs in a worker thread, never on the
 * thread serving requests. No `server-only` marker, so `bun run worker` and the CLI can use it too.
 *
 * The threads run `.engine-worker/engine-thread.mjs`, which `bun run engine:build` writes (`dev`,
 * `build`, `worker` and the integration tests run it first). `ENGINE_WORKER_PATH` points elsewhere,
 * `ENGINE_POOL_SIZE` sets the thread count (default: CPU count − 1, at least 1, at most 4).
 */
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createWorkerPool, type EnginePool } from "./pool";

/** Where `bun run engine:build` writes the thread bundle, relative to the project root. */
export const ENGINE_WORKER_FILE = ".engine-worker/engine-thread.mjs";

export class EngineWorkerMissingError extends Error {
  constructor(path: string) {
    super(`The engine worker bundle is missing at ${path}. Run \`bun run engine:build\` first.`);
    this.name = "EngineWorkerMissingError";
  }
}

function engineWorkerPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ENGINE_WORKER_PATH || join(/* turbopackIgnore: true */ process.cwd(), ENGINE_WORKER_FILE);
}

function defaultPoolSize(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ENGINE_POOL_SIZE);
  if (Number.isInteger(n) && n > 0) return n;
  return Math.max(1, Math.min(4, availableParallelism() - 1));
}

/** A pool running the engine thread bundle at `path`. Throws when it hasn't been built. */
export function createEnginePool(path = engineWorkerPath(), size = defaultPoolSize()): EnginePool {
  if (!existsSync(path)) throw new EngineWorkerMissingError(path);
  return createWorkerPool({ spawn: () => new Worker(path, { name: "crate-engine" }), size });
}

const holder = globalThis as typeof globalThis & { __crateDesignerEnginePool?: EnginePool };

/** The process's pool, started on first use and kept across dev-mode hot reloads. */
export function getEnginePool(): EnginePool {
  return (holder.__crateDesignerEnginePool ??= createEnginePool());
}

export type { EnginePool } from "./pool";

/** Closes the process's pool, if one was started (tests, graceful shutdown). */
export async function closeEnginePool(): Promise<void> {
  const pool = holder.__crateDesignerEnginePool;
  holder.__crateDesignerEnginePool = undefined;
  await pool?.close();
}
