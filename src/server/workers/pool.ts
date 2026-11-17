/**
 * A small `worker_threads` pool (#46 slice 7): server-side engine work (sweeps, designs, file
 * builds) runs here, never on the thread that serves requests and SSE streams, so a 200–400 ms
 * sweep can't stall them (the event-loop-lag test in `pool.integration.test.ts` holds it under 50 ms).
 *
 * - Up to `size` threads, started on demand; tasks wait in FIFO order for a free one.
 * - A thread that crashes (or exits) fails only its own task and is replaced on the next one.
 * - A task over `timeoutMs` fails and its thread is terminated, so one stuck call can't hold a slot.
 * - `close()` terminates every thread and fails whatever is still waiting.
 */
import { Worker } from "node:worker_threads";
import type { EngineTaskKind, EngineTaskMessage, EngineTaskResult, EngineTasks } from "./tasks";

export interface WorkerPoolOptions {
  /** Starts one thread (the engine thread bundle, or a stand-in in tests). */
  spawn: () => Worker;
  /** Threads at most. */
  size?: number;
  /** Per-task limit; the thread running an overdue task is terminated. */
  timeoutMs?: number;
}

export interface EnginePool {
  run<K extends EngineTaskKind>(kind: K, input: EngineTasks[K]["input"], transfer?: ArrayBuffer[]): Promise<EngineTasks[K]["output"]>;
  /** Threads started and busy, and tasks waiting. */
  stats(): { threads: number; busy: number; waiting: number };
  close(): Promise<void>;
}

interface Task {
  id: number;
  msg: EngineTaskMessage;
  transfer: ArrayBuffer[];
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  task: Task | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class PoolClosedError extends Error {
  constructor() {
    super("The engine worker pool is closed.");
    this.name = "PoolClosedError";
  }
}

export function createWorkerPool({ spawn, size = 2, timeoutMs = 120_000 }: WorkerPoolOptions): EnginePool {
  const slots: Slot[] = [];
  const waiting: Task[] = [];
  let ids = 0;
  let closed = false;

  const finish = (slot: Slot) => {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    // An idle thread never keeps the process alive; a busy one does (a CLI waits for its answer).
    slot.worker.unref();
    const task = slot.task;
    slot.task = null;
    return task;
  };

  /** Drops a dead slot, failing its task, and lets the queue move on. */
  const retire = (slot: Slot, why: Error) => {
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    finish(slot)?.reject(why);
    void slot.worker.terminate().catch(() => {});
    pump();
  };

  const startSlot = (): Slot => {
    const slot: Slot = { worker: spawn(), task: null, timer: null };
    slot.worker.unref();
    slot.worker.on("message", (res: EngineTaskResult) => {
      if (slot.task?.id !== res.id) return;
      const task = finish(slot)!;
      if (res.ok) task.resolve(res.output);
      else task.reject(new Error(res.error));
      pump();
    });
    slot.worker.on("error", (e) => retire(slot, e instanceof Error ? e : new Error(String(e))));
    slot.worker.on("exit", (code) => {
      if (slots.includes(slot)) retire(slot, new Error(`The engine worker thread exited (code ${code}).`));
    });
    slots.push(slot);
    return slot;
  };

  const dispatch = (slot: Slot, task: Task) => {
    slot.task = task;
    slot.worker.ref();
    slot.timer = setTimeout(() => retire(slot, new Error(`The engine task (${task.msg.kind}) took longer than ${timeoutMs} ms.`)), timeoutMs);
    slot.timer.unref?.();
    try {
      slot.worker.postMessage(task.msg, task.transfer);
    } catch (e) {
      finish(slot);
      task.reject(e instanceof Error ? e : new Error(String(e)));
      pump();
    }
  };

  function pump(): void {
    while (!closed && waiting.length) {
      const slot = slots.find((s) => !s.task) ?? (slots.length < size ? startSlot() : null);
      if (!slot) return;
      dispatch(slot, waiting.shift()!);
    }
  }

  return {
    run(kind, input, transfer = []) {
      if (closed) return Promise.reject(new PoolClosedError());
      return new Promise((resolve, reject) => {
        const id = ++ids;
        waiting.push({ id, msg: { id, kind, input } as EngineTaskMessage, transfer, resolve: resolve as (v: unknown) => void, reject });
        pump();
      });
    },
    stats: () => ({ threads: slots.length, busy: slots.filter((s) => s.task).length, waiting: waiting.length }),
    async close() {
      closed = true;
      for (const t of waiting.splice(0)) t.reject(new PoolClosedError());
      const all = slots.splice(0);
      for (const s of all) finish(s)?.reject(new PoolClosedError());
      await Promise.all(all.map((s) => s.worker.terminate().catch(() => 0)));
    },
  };
}
