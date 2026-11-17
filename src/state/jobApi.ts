/**
 * The browser's calls to `/api/v1/parts` and `/api/v1/jobs*` (#46, docs/API.md). Never throws:
 * every call resolves to a `Result`, and anything that isn't an answer from a working server (no
 * network, the server down, the database down: a 5xx) is `offline`, so the app carries on without
 * saving rather than showing an error.
 */
import {
  type CreateJobRequest,
  CreateJobResponseSchema,
  EngineMismatchErrorSchema,
  IDEMPOTENCY_KEY_HEADER,
  JobSnapshotSchema,
  type PatchJobRequest,
  PatchJobResponseSchema,
  type SaveConfigurationRequest,
  SaveConfigurationResponseSchema,
  VersionConflictErrorSchema,
  type JobResponse,
} from "@/lib/api/jobs";
import { ApiErrorSchema, CreatePartResponseSchema } from "@/lib/api/parts";
import type { z } from "zod";

export type Result<T> =
  | { ok: true; status: number; data: T }
  /** No usable answer: network error, timeout, 5xx or a body that isn't the API's. */
  | { ok: false; kind: "offline" }
  /** 409 `engine_version_mismatch`: this tab's engine is not the server's. Reload. */
  | { ok: false; kind: "reload"; engineVersion: string }
  /** 409 `version_conflict`: the job moved on; `job` is how it is now. */
  | { ok: false; kind: "conflict"; job: JobResponse }
  /** Any other 4xx: the server understood and said no. `message` can be shown as is. */
  | { ok: false; kind: "rejected"; status: number; code: string; message: string };

export type ApiOptions = {
  fetch?: typeof fetch;
  /** Origin of the API; same origin when omitted. */
  baseUrl?: string;
  /** Sent as `Idempotency-Key` so a resend is applied once (the offline queue sets it). */
  idempotencyKey?: string;
  /** Give up (as `offline`) after this long. */
  timeoutMs?: number;
};

export const API_TIMEOUT_MS = 8000;
/** The liveness probe gives up sooner: it runs every few seconds while offline. */
export const HEALTH_TIMEOUT_MS = 2500;

async function call<S extends z.ZodType>(path: string, init: RequestInit, schema: S, opts: ApiOptions = {}): Promise<Result<z.infer<S>>> {
  const { fetch: doFetch = globalThis.fetch, baseUrl = "", idempotencyKey, timeoutMs = API_TIMEOUT_MS } = opts;
  const headers = new Headers(init.headers);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  let res: Response;
  try {
    res = await doFetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, kind: "offline" };
  }
  if (res.status >= 500) return { ok: false, kind: "offline" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: "offline" };
  }
  if (res.ok) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { ok: true, status: res.status, data: parsed.data } : { ok: false, kind: "offline" };
  }
  const engine = EngineMismatchErrorSchema.safeParse(body);
  if (res.status === 409 && engine.success) return { ok: false, kind: "reload", engineVersion: engine.data.engineVersion };
  const conflict = VersionConflictErrorSchema.safeParse(body);
  if (res.status === 409 && conflict.success) return { ok: false, kind: "conflict", job: conflict.data.job };
  const error = ApiErrorSchema.safeParse(body);
  if (!error.success) return { ok: false, kind: "offline" };
  return { ok: false, kind: "rejected", status: res.status, code: error.data.error.code, message: error.data.error.message };
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const uploadPart = (form: FormData, opts?: ApiOptions) => call("/api/v1/parts", { method: "POST", body: form }, CreatePartResponseSchema, opts);

export const createJob = (body: CreateJobRequest, opts?: ApiOptions) => call("/api/v1/jobs", jsonInit("POST", body), CreateJobResponseSchema, opts);

export const fetchJob = (jobId: string, opts?: ApiOptions) =>
  call(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { method: "GET", cache: "no-store" }, JobSnapshotSchema, opts);

export const postConfiguration = (jobId: string, body: SaveConfigurationRequest, opts?: ApiOptions) =>
  call(`/api/v1/jobs/${encodeURIComponent(jobId)}/configs`, jsonInit("POST", body), SaveConfigurationResponseSchema, opts);

export const patchJob = (jobId: string, body: PatchJobRequest, opts?: ApiOptions) =>
  call(`/api/v1/jobs/${encodeURIComponent(jobId)}`, jsonInit("PATCH", body), PatchJobResponseSchema, opts);

/** `GET /api/v1/health` answered 200: the server and its database are up. Never throws. */
export async function probeHealth(opts: ApiOptions = {}): Promise<boolean> {
  const { fetch: doFetch = globalThis.fetch, baseUrl = "", timeoutMs = HEALTH_TIMEOUT_MS } = opts;
  try {
    const res = await doFetch(`${baseUrl}/api/v1/health`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
