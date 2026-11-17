import { describe, expect, it, vi } from "vitest";
import { createJob, fetchJob, patchJob } from "./jobApi";

const JOB = "00000000-0000-4000-8000-0000000000aa";
const job = {
  id: JOB,
  partId: "00000000-0000-4000-8000-0000000000bb",
  status: "open",
  totalQuantity: null,
  selectedConfigurationId: null,
  notes: null,
  version: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("jobApi", () => {
  it("parses a success and sends the Idempotency-Key", async () => {
    const fetch = reply(201, { job, created: true });
    const r = await createJob({ catalogId: "PART-001", reuse: true }, { fetch, idempotencyKey: "k-1" });
    expect(r).toEqual({ ok: true, status: 201, data: { job, created: true } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/jobs");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("k-1");
    expect(JSON.parse(String(init.body))).toEqual({ catalogId: "PART-001", reuse: true });
  });

  it("treats no network, a 5xx and a foreign body as offline, never throwing", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchJob(JOB, { fetch: down })).toEqual({ ok: false, kind: "offline" });
    expect(await fetchJob(JOB, { fetch: reply(500, { error: { code: "internal", message: "x" } }) })).toEqual({ ok: false, kind: "offline" });
    expect(await fetchJob(JOB, { fetch: vi.fn(async () => new Response("<html>", { status: 404 })) })).toEqual({ ok: false, kind: "offline" });
    expect(await fetchJob(JOB, { fetch: reply(200, { not: "a snapshot" }) })).toEqual({ ok: false, kind: "offline" });
  });

  it("recognises the reload, conflict and rejection answers", async () => {
    const engine = reply(409, { error: { code: "engine_version_mismatch", message: "Reload" }, engineVersion: "9.9.9+engine.9" });
    expect(await patchJob(JOB, { version: 1, notes: "x" }, { fetch: engine })).toEqual({ ok: false, kind: "reload", engineVersion: "9.9.9+engine.9" });
    const stale = reply(409, { error: { code: "version_conflict", message: "Changed" }, job });
    expect(await patchJob(JOB, { version: 1, notes: "x" }, { fetch: stale })).toEqual({ ok: false, kind: "conflict", job });
    const missing = reply(404, { error: { code: "not_found", message: "No such job." } });
    expect(await fetchJob(JOB, { fetch: missing })).toEqual({ ok: false, kind: "rejected", status: 404, code: "not_found", message: "No such job." });
  });
});
