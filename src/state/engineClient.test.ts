import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { designShipment } from "@/engine/engine";
import { parityRequest } from "@/engine/parityCases";
import type { DesignResponse } from "@/engine/schemas";
import { createEngineClient } from "./engineClient";
import { FakeEngineWorker } from "./fakeEngineWorker";

const req = (q: number) => parityRequest("PART-001", q);

describe("engine client", () => {
  beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("designs in this thread, before returning, where there is no worker (tests, SSR)", () => {
    const client = createEngineClient();
    let got: DesignResponse | null = null;
    client.design(req(4), (out) => (got = out));
    expect(got).toEqual(designShipment(req(4)));
    expect(client.inWorker).toBe(false);
  });

  it("designs in the worker and applies the answer when it comes", () => {
    const worker = new FakeEngineWorker();
    const client = createEngineClient(() => worker);
    const got: number[] = [];
    client.design(req(4), (out) => got.push(out.summary.quantity));
    expect(client.inWorker).toBe(true);
    expect(got).toEqual([]);
    worker.flush();
    expect(got).toEqual([4]);
  });

  it("is latest-wins: one request in flight, and a newer one replaces the one waiting", () => {
    const worker = new FakeEngineWorker();
    const client = createEngineClient(() => worker);
    const got: number[] = [];
    for (const q of [1, 2, 3, 4]) client.design(req(q), (out) => got.push(out.summary.quantity));
    expect(worker.inbox.map((m) => m.request.settings.quantity)).toEqual([1]);
    worker.flush();
    expect(got).toEqual([1, 4]);
  });

  it("gives the same result and hash as the engine in this thread", () => {
    const worker = new FakeEngineWorker();
    const client = createEngineClient(() => worker);
    let got: DesignResponse | null = null;
    client.design(req(8), (out) => (got = out));
    worker.flush();
    expect(got).toEqual(client.designSync(req(8)));
  });

  it("falls back to this thread when the worker fails, finishing what was waiting", () => {
    const worker = new FakeEngineWorker();
    const client = createEngineClient(() => worker);
    const got: number[] = [];
    client.design(req(1), (out) => got.push(out.summary.quantity));
    client.design(req(2), (out) => got.push(out.summary.quantity));
    worker.fail();
    expect(got).toEqual([1, 2]);
    expect(worker.terminated).toBe(true);
    client.design(req(3), (out) => got.push(out.summary.quantity));
    expect(got).toEqual([1, 2, 3]);
    expect(client.inWorker).toBe(false);
  });

  it("falls back when the worker reports an error or a request can't be sent", () => {
    const worker = new FakeEngineWorker();
    const client = createEngineClient(() => worker);
    const got: number[] = [];
    client.design(req(1), (out) => got.push(out.summary.quantity));
    worker.onmessage?.({ data: { id: 1, ok: false, error: "boom" } });
    expect(got).toEqual([1]);

    const throwing = new FakeEngineWorker();
    throwing.postMessage = () => {
      throw new DOMException("could not be cloned", "DataCloneError");
    };
    const other = createEngineClient(() => throwing);
    other.design(req(2), (out) => got.push(out.summary.quantity));
    expect(got).toEqual([1, 2]);
  });
});
