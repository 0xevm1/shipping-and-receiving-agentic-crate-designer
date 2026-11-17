/**
 * The one way to produce an event (#46 §3). Call it inside the transaction that makes the change,
 * as its last statement, once per user action:
 *
 *   await inTransaction(getDb(), async (tx) => {
 *     const saved = await tx.configurations.save(ctx, input);
 *     await emitEvent(tx, ctx, { jobId, type: "config.added", payload: { configurationId: saved.row.id, inputHash } });
 *   });
 *
 * The `event` row and its NOTIFY commit (or roll back) with the change. Emitting last keeps the
 * event-ordering lock (see `events.append`) held for as short a time as possible.
 */
import { type CrateEventPayload, type CrateEventType, parseEventPayload } from "@/lib/events";
import type { OrgContext } from "@/server/db/org";
import type { CrateEvent, Repository } from "@/server/db/repository";

/** Events about the org rather than one job; every other type needs a `jobId`. */
const JOBLESS_TYPES: ReadonlySet<CrateEventType> = new Set(["engine.updated", "part.created"]);

export type EmitEventInput<T extends CrateEventType> = {
  /** Null only for org-wide types (`engine.updated`, `part.created`); those reach every job's stream. */
  jobId: string | null;
  type: T;
  payload: CrateEventPayload<T>;
};

/**
 * Appends an event through `tx`, the repository `inTransaction` hands you. Validates the payload
 * against its type's schema and the size cap first, so a bad event fails the whole transaction.
 */
export async function emitEvent<T extends CrateEventType>(tx: Repository, ctx: OrgContext, input: EmitEventInput<T>): Promise<CrateEvent> {
  if (input.jobId === null && !JOBLESS_TYPES.has(input.type)) throw new Error(`Event ${input.type} needs a jobId.`);
  const payload = parseEventPayload(input.type, input.payload);
  return tx.events.append(ctx, { jobId: input.jobId, type: input.type, payload });
}
