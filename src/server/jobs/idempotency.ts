/**
 * `Idempotency-Key` (#46 §7a): a client-generated id per change, so a change sent twice (a lost
 * response, an offline replay, two tabs) is applied once. The first request's status and body
 * are stored with the key, in the same transaction as the change, and returned for every repeat.
 * The same key with a different request (method, path or body) is refused with 422.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@/engine/canonical";
import { IDEMPOTENCY_KEY_HEADER, MAX_IDEMPOTENCY_KEY_LENGTH } from "@/lib/api/jobs";
import type { OrgContext } from "../db/org";
import type { Repository } from "../db/repository";
import { ApiFailure } from "../http";

export type Outcome<T> = { status: number; body: T; replayed: boolean };

/** The header's value, or null when absent. Throws 400 for an unusable one. */
export function idempotencyKey(request: Request): string | null {
  const raw = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === null) return null;
  const key = raw.trim();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
    throw new ApiFailure(400, "invalid_request", `${IDEMPOTENCY_KEY_HEADER} must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} visible ASCII characters.`);
  }
  return key;
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method} ${path}\n${canonicalJson(body)}`)
    .digest("hex");
}

/**
 * What `work` did: the response, and `emit`, the change's events, run after the key is stored
 * so they stay the transaction's last statements (see `emitEvent`).
 */
export type Work<T> = { status: number; body: T; emit?: () => Promise<unknown> };

/**
 * The stored answer for `key`, read outside any transaction, or null when the key is new. Lets a
 * request skip expensive work (a save's engine recompute) that a repeat doesn't need. `once`
 * still decides inside the transaction, so two first requests racing on one key stay correct.
 */
export async function storedOutcome<T>(repo: Repository, ctx: OrgContext, key: string | null, hash: string): Promise<Outcome<T> | null> {
  if (key === null) return null;
  const seen = await repo.idempotency.get(ctx, key);
  if (!seen) return null;
  if (seen.requestHash !== hash) {
    throw new ApiFailure(422, "idempotency_conflict", `This ${IDEMPOTENCY_KEY_HEADER} was already used for a different request.`);
  }
  return { status: seen.statusCode, body: seen.response as T, replayed: true };
}

/**
 * Runs `work` once per key, inside the caller's transaction `tx`. Without a key it just runs.
 * Errors aren't stored: a request that failed can be retried with the same key.
 */
export async function once<T>(tx: Repository, ctx: OrgContext, key: string | null, hash: string, work: () => Promise<Work<T>>): Promise<Outcome<T>> {
  if (key === null) {
    const { status, body, emit } = await work();
    await emit?.();
    return { status, body, replayed: false };
  }
  const seen = await tx.idempotency.claim(ctx, key, hash);
  if (seen) {
    if (seen.requestHash !== hash) {
      throw new ApiFailure(422, "idempotency_conflict", `This ${IDEMPOTENCY_KEY_HEADER} was already used for a different request.`);
    }
    return { status: seen.statusCode, body: seen.response as T, replayed: true };
  }
  const { status, body, emit } = await work();
  await tx.idempotency.complete(ctx, key, status, body);
  await emit?.();
  return { status, body, replayed: false };
}
