// "Interaction stays instant" (#46 acceptance, spec §5.1): a quantity, layout or rule change is
// designed and lands in the store's callback well under 100 ms, with no network round trip.
//
// Measured on the page's engine client through the worker protocol (`createEngineClient` with a
// stand-in worker that copies each message with `structuredClone`, as postMessage does, and answers
// on the next task), so the cost of the request, the copy both ways and the design is in the
// number. A real Web Worker adds a thread hop (well under 1 ms); the 3D view then renders the
// result on its next frame. Measured at 2–4 ms per change (10–16 ms at 200 parts per crate); the budget is load-aware and the median
// of several runs (src/domain/testTiming.ts, #48), so it doesn't flake on a busy machine.
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog } from "@/domain/catalog";
import { loadAwareBudget, median } from "@/domain/testTiming";
import { parityRequest } from "@/engine/parityCases";
import { runWorkerRequest } from "@/engine/run";
import type { DesignRequest, DesignResponse, WorkerRequest, WorkerResponse } from "@/engine/schemas";
import { createEngineClient, type WorkerLike } from "./engineClient";

const INSTANT_MS = 100;

/** A worker on this thread that behaves like one across threads: copied messages, async answers. */
function copyingWorker(): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate() {},
    postMessage(msg: WorkerRequest) {
      const copy = structuredClone(msg);
      setTimeout(() => {
        const res: WorkerResponse = structuredClone(runWorkerRequest(copy));
        w.onmessage?.({ data: res });
      }, 0);
    },
  };
  return w;
}

const client = createEngineClient(copyingWorker);
const designed = (req: DesignRequest) => new Promise<DesignResponse>((resolve) => client.design(req, resolve));

async function timeEdit(req: DesignRequest): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const out = await designed(req);
    times.push(performance.now() - t0);
    expect(out.inputHash).toMatch(/^[0-9a-f]{64}$/);
  }
  return median(times);
}

afterEach(() => vi.unstubAllGlobals());

describe.each(catalog.parts.map((p) => p.id))("%s: an edit lands without a network round trip, in well under 100 ms", (id) => {
  const base = parityRequest(id, 4);

  it("quantity, layout and rule changes", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in an edit")));
    vi.stubGlobal("fetch", fetchSpy);
    const budget = loadAwareBudget(INSTANT_MS, 30);
    const first = await designed(base);
    const layouts = first.plan.crates[0]!.result.layouts;
    const edits: [string, DesignRequest][] = [
      ["quantity 1", { ...base, settings: { ...base.settings, quantity: 1 } }],
      ["quantity 200", { ...base, settings: { ...base.settings, quantity: 200 } }],
      ["another layout", { ...base, layoutKey: (layouts[1] ?? layouts[0]!).key }],
      ["a wider part gap", { ...base, settings: { ...base.settings, partGapMm: base.settings.partGapMm + 25 } }],
      ["laid down", { ...base, settings: { ...base.settings, keepUpright: !base.settings.keepUpright } }],
      ["cost ranking", { ...base, ranking: "cost" }],
    ];
    for (const [what, req] of edits) {
      const ms = await timeEdit(req);
      expect(ms, `${id}, ${what}: ${ms.toFixed(1)} ms`).toBeLessThan(budget);
    }
    expect(client.inWorker).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
