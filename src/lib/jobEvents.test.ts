import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobEventMessage } from "./events";
import { subscribeJobEvents } from "./jobEvents";

const JOB = "00000000-0000-4000-8000-0000000000aa";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(id: number, type = "job.error") {
    const data = JSON.stringify({ id, jobId: JOB, type, payload: { message: "m" }, createdAt: "2026-01-01T00:00:00.000Z" });
    this.onmessage?.({ data, lastEventId: String(id) } as MessageEvent<string>);
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.useRealTimers();
});

const open = (opts = {}) => {
  const got: JobEventMessage[] = [];
  const stop = subscribeJobEvents(JOB, (e) => got.push(e), { EventSourceImpl: FakeEventSource as unknown as typeof EventSource, reconnectMs: 100, ...opts });
  return { got, stop, es: () => FakeEventSource.instances.at(-1)! };
};

describe("subscribeJobEvents", () => {
  it("connects to the job's stream and delivers each event once, in order", () => {
    const { got, es } = open();
    expect(es().url).toBe(`/api/v1/events?job=${JOB}`);
    es().emit(1);
    es().emit(2);
    es().emit(2); // a duplicate after a reconnect
    es().emit(1);
    expect(got.map((e) => e.id)).toEqual([1, 2]);
  });

  it("skips unknown event types but still advances past them", () => {
    const { got, es } = open();
    es().emit(1, "from.the.future");
    es().emit(2);
    expect(got.map((e) => e.id)).toEqual([2]);
  });

  it("reopens a closed stream with the last id as lastEventId", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { got, es } = open({ lastEventId: 4, onError });
    expect(es().url).toContain("lastEventId=4");
    es().emit(5);
    const first = es();
    first.readyState = 2;
    first.onerror?.();
    expect(onError).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(es().url).toBe(`/api/v1/events?job=${JOB}&lastEventId=5`);
    es().emit(6);
    expect(got.map((e) => e.id)).toEqual([5, 6]);
  });

  it("leaves a retrying stream alone and stops cleanly", () => {
    vi.useFakeTimers();
    const { stop, es } = open();
    es().readyState = 0; // CONNECTING: the browser is retrying by itself
    es().onerror?.();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(1);
    stop();
    expect(es().closed).toBe(true);
  });
});
