/** JSON responses for the `/api/v1` Route Handlers (#46). */
import type { ApiError } from "@/lib/api/parts";

type Code = ApiError["error"]["code"];

/** Responses here are per user and may carry presigned URLs: never cache them. */
export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** A failure the client can act on: its message is shown to the user as is. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: Code,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export function json<T>(body: T, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Turns a thrown error into a response. An `ApiFailure` keeps its message; anything else is a
 * 500 with a generic one, so driver or S3 errors (endpoints, bucket names, signatures) never
 * reach the client. Those go to the server log instead.
 */
export function errorResponse(e: unknown, where: string): Response {
  if (e instanceof ApiFailure) {
    const body: ApiError = { error: { code: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) } };
    return json(body, e.status);
  }
  console.error(`${where} failed:`, e);
  const body: ApiError = { error: { code: "internal", message: "Something went wrong on the server. Try again." } };
  return json(body, 500);
}
