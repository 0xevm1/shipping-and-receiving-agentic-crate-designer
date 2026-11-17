// SSE client worker for the load test (docs/LOAD_TEST.md). A `worker_threads` worker, so the
// streams' parsing is spread over several cores and doesn't delay the save scheduler.
//
// In:  { kind: "open", baseUrl, jobs, offset, batch }  one stream per entry of `jobs` (a job id),
//                                                     opened `batch` at a time
//      { kind: "collect" }                            send the arrivals so far and clear them
//      { kind: "close" }                              abort every stream
// Out: { kind: "opened", ok, failed }                 every stream sent its first bytes (or failed)
//      { kind: "arrivals", arrivals, errors, lagMaxMs }
//      { kind: "closed" }
//
// An arrival is [streamIndex, jobId, inputHash, receivedAtMs] for each `config.added` event.
import { parentPort } from "node:worker_threads";
import { now, readEvents } from "./sse.mjs";

let controllers = [];
let arrivals = [];
let errors = [];

// This thread's own event-loop lag: if it grows, measured latencies include client-side delay.
let lagMaxMs = 0;
let expected = now() + 50;
setInterval(() => {
  const t = now();
  lagMaxMs = Math.max(lagMaxMs, t - expected);
  expected = t + 50;
}, 50);

/** Opens one stream; resolves true on its first bytes, false if it fails first. */
function open(baseUrl, jobId, index) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    controllers.push(controller);
    let settled = false;
    void readEvents(baseUrl, jobId, controller.signal, {
      onOpen() {
        settled = true;
        resolve(true);
      },
      onMessage(m, t) {
        const hash = m.payload?.inputHash;
        if (m.type === "config.added" && typeof hash === "string") arrivals.push([index, jobId, hash, t]);
      },
      onError(reason) {
        errors.push(`stream ${index}: ${reason}`);
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
  });
}

parentPort.on("message", async (msg) => {
  if (msg.kind === "open") {
    let ok = 0;
    let failed = 0;
    // In batches: a burst of connects past the OS accept backlog (128 on macOS) gets reset.
    for (let b = 0; b < msg.jobs.length; b += msg.batch) {
      const results = await Promise.all(msg.jobs.slice(b, b + msg.batch).map((jobId, i) => open(msg.baseUrl, jobId, msg.offset + b + i)));
      ok += results.filter(Boolean).length;
      failed += results.filter((good) => !good).length;
    }
    parentPort.postMessage({ kind: "opened", ok, failed });
  } else if (msg.kind === "collect") {
    parentPort.postMessage({ kind: "arrivals", arrivals, errors, lagMaxMs });
    arrivals = [];
    errors = [];
    lagMaxMs = 0;
  } else if (msg.kind === "close") {
    for (const c of controllers) c.abort();
    controllers = [];
    parentPort.postMessage({ kind: "closed" });
  }
});
