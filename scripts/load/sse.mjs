// A minimal SSE reader over fetch for the load test (docs/LOAD_TEST.md). EventSource would hide
// when a chunk arrived and reconnect on its own; here every `data:` message is timestamped the
// moment its chunk is read, and a dropped stream is an error, not a silent retry.

/** Wall-clock ms with sub-ms precision, comparable across the worker threads of one process. */
export const now = () => performance.timeOrigin + performance.now();

/**
 * Opens `GET /api/v1/events?job=` and reads it until `signal` aborts.
 * @param {string} baseUrl
 * @param {string} jobId
 * @param {AbortSignal} signal
 * @param {{ onOpen(): void, onMessage(message: { type: string, payload: Record<string, unknown> }, receivedAt: number): void, onError(reason: string): void }} handlers
 */
export async function readEvents(baseUrl, jobId, signal, handlers) {
  let opened = false;
  try {
    const res = await fetch(`${baseUrl}/api/v1/events?job=${jobId}`, { headers: { accept: "text/event-stream" }, signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const t = now();
      if (!opened) {
        opened = true;
        handlers.onOpen();
      }
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) handlers.onMessage(JSON.parse(line.slice(6)), t);
        }
      }
    }
    if (!signal.aborted) handlers.onError("ended by the server");
  } catch (err) {
    if (!signal.aborted) handlers.onError(err?.cause?.code ?? err?.message ?? String(err));
  }
}
