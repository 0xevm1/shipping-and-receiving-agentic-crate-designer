import { describe, expect, it, vi } from "vitest";
import type { EventNotification } from "@/lib/events";
import { createEventHub } from "./hub";

const ORG = "00000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const quiet = { warn: () => {}, error: () => {} };
const n = (id: number, jobId: string | null = A): EventNotification => ({ id, orgId: ORG, jobId, type: "job.error" });
const flush = () => new Promise((r) => setImmediate(r));

describe("event hub", () => {
  it("delivers a job's events to that job's subscribers, and org-wide ones to all", async () => {
    const hub = createEventHub(quiet);
    const a: number[] = [];
    const b: number[] = [];
    hub.subscribe(A, { onEvent: (e) => void a.push(e.id) });
    hub.subscribe(B, { onEvent: (e) => void b.push(e.id) });
    hub.publish(n(1, A));
    hub.publish(n(2, B));
    hub.publish(n(3, null));
    await flush();
    expect(a).toEqual([1, 3]);
    expect(b).toEqual([2, 3]);
  });

  it("stops delivering after unsubscribe", async () => {
    const hub = createEventHub(quiet);
    const got: number[] = [];
    const off = hub.subscribe(A, { onEvent: (e) => void got.push(e.id) });
    hub.publish(n(1));
    await flush();
    off();
    hub.publish(n(2));
    await flush();
    expect(got).toEqual([1]);
    expect(hub.size).toBe(0);
  });

  it("delivers to one subscriber in order, one at a time", async () => {
    const hub = createEventHub(quiet);
    const got: number[] = [];
    let inFlight = 0;
    hub.subscribe(A, {
      async onEvent(e) {
        expect(++inFlight).toBe(1);
        await flush();
        got.push(e.id);
        inFlight--;
      },
    });
    for (let i = 1; i <= 5; i++) hub.publish(n(i));
    await vi.waitFor(() => expect(got).toEqual([1, 2, 3, 4, 5]));
  });

  it("drops a subscriber that falls behind without holding up the others", async () => {
    const hub = createEventHub(quiet);
    const onDrop = vi.fn();
    const fast: number[] = [];
    hub.subscribe(A, { onEvent: () => new Promise(() => {}), onDrop }, { maxBuffered: 3 });
    hub.subscribe(A, { onEvent: (e) => void fast.push(e.id) });
    for (let i = 1; i <= 10; i++) hub.publish(n(i));
    await flush();
    expect(fast).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(onDrop).toHaveBeenCalledExactlyOnceWith("slow");
    expect(hub.size).toBe(1);
  });

  it("asks every subscriber to resync, and keeps going when one throws", async () => {
    const hub = createEventHub(quiet);
    const resynced: string[] = [];
    hub.subscribe(A, {
      onEvent: () => {
        throw new Error("boom");
      },
      onResync: () => void resynced.push("a"),
    });
    hub.subscribe(B, { onEvent: () => {}, onResync: () => void resynced.push("b") });
    hub.publish(n(1));
    hub.resyncAll();
    await flush();
    expect(resynced.sort()).toEqual(["a", "b"]);
  });

  it("dropAll ends every subscription", () => {
    const hub = createEventHub(quiet);
    const onDrop = vi.fn();
    hub.subscribe(A, { onEvent: () => {}, onDrop });
    hub.subscribe(B, { onEvent: () => {}, onDrop });
    hub.dropAll("stopped");
    expect(onDrop).toHaveBeenCalledTimes(2);
    expect(hub.size).toBe(0);
  });
});
