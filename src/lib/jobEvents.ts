/**
 * Browser side of `GET /api/v1/events?job=…` (#46 §3): an EventSource that resumes where it left
 * off. While the EventSource reconnects by itself it resends the last `id:` as `Last-Event-ID`;
 * when it gives up (an HTTP error closes it for good) this helper opens a new one after
 * `reconnectMs`, passing the last id as `?lastEventId=` because a new EventSource can't set
 * headers. Ids already delivered are skipped, so `onEvent` sees each event once, in order.
 */
import { type JobEventMessage, JobEventMessageSchema } from "./events";

export type JobEventsOptions = {
  /** Resume after this event id (e.g. from a snapshot); 0 replays the job's whole history. */
  lastEventId?: number;
  /** The stream is open (first connect and every reconnect): the server is reachable. */
  onOpen?: () => void;
  /** The stream dropped; it will reconnect on its own. */
  onError?: () => void;
  /** Origin of the API; same origin when omitted. */
  baseUrl?: string;
  /** Wait before reopening an EventSource that closed for good. */
  reconnectMs?: number;
  /** For tests and polyfills. */
  EventSourceImpl?: typeof EventSource;
};

const CLOSED = 2; // EventSource.CLOSED

/** Calls `onEvent` for each event of `jobId`. Returns a function that stops listening. */
export function subscribeJobEvents(jobId: string, onEvent: (event: JobEventMessage) => void, options: JobEventsOptions = {}): () => void {
  const { onOpen, onError, baseUrl = "", reconnectMs = 3000, EventSourceImpl = globalThis.EventSource } = options;
  let lastId = options.lastEventId ?? 0;
  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function open(): void {
    const query = new URLSearchParams({ job: jobId });
    if (lastId > 0) query.set("lastEventId", String(lastId));
    const es = new EventSourceImpl(`${baseUrl}/api/v1/events?${query}`);
    source = es;
    es.onopen = () => onOpen?.();
    es.onmessage = (message: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      const id = Number((data as { id?: unknown })?.id ?? message.lastEventId);
      if (!Number.isSafeInteger(id) || id <= lastId) return; // Already delivered.
      lastId = id;
      const parsed = JobEventMessageSchema.safeParse(data);
      if (parsed.success) onEvent(parsed.data); // An unknown (newer) type is skipped, not fatal.
    };
    es.onerror = () => {
      onError?.();
      if (stopped || es.readyState !== CLOSED) return; // The EventSource retries by itself.
      es.close();
      retry = setTimeout(() => {
        if (!stopped) open();
      }, reconnectMs);
    };
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    source?.close();
  };
}
