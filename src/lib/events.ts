/**
 * Live event types (#46 §3), shared by the server (which emits them), the SSE route and the
 * browser (which validates what it receives). No server-only imports: Client Components may use
 * this file. docs/POSTGRES.md "Events" lists the types and what each payload carries.
 */
import { z } from "zod";

/** The one NOTIFY channel every process LISTENs on. The `event` trigger's migration names it too. */
export const CRATE_EVENTS_CHANNEL = "crate_events";

/** Upper bound on an event's JSON payload, in bytes. Payloads are hints; details are fetched by id. */
export const MAX_EVENT_PAYLOAD_BYTES = 4096;

const id = z.uuid();

/**
 * Payload per event type. Loose objects: a producer may add fields without breaking older
 * clients, but the fields named here are required.
 */
export const EVENT_PAYLOADS = {
  /** A part was stored (upload or catalog). */
  "part.created": z.looseObject({ partId: id }),
  /** A design job was opened for a part. */
  "job.created": z.looseObject({ partId: id }),
  /**
   * The quantity sweep finished: the shortlist and curve are saved. With a total quantity it also
   * planned the total (spec §7.16): `totalPlan` is a hint of the stored plan (`{ total, crates,
   * perCrate, scoreUsdPerPart }`), null when there is none or the total changed meanwhile; the
   * plan itself is in the job's snapshot (`totalPlan`).
   */
  "configs.ready": z.looseObject({
    count: z.int().nonnegative(),
    totalPlan: z
      .object({
        total: z.int().positive(),
        crates: z.int().positive().nullable(),
        perCrate: z.int().positive().nullable(),
        scoreUsdPerPart: z.number().nullable(),
      })
      .nullable()
      .optional(),
  }),
  /** A user changed a parameter and saved the configuration. */
  "config.added": z.looseObject({ configurationId: id, inputHash: z.string().min(1) }),
  /** The job's selected (recommended) configuration changed; null when cleared. */
  "recommendation.changed": z.looseObject({ configurationId: id.nullable() }),
  /** A generated file is in blob storage. */
  "artifact.ready": z.looseObject({ artifactId: id, configurationId: id, kind: z.string().min(1) }),
  /** The job is designed from a new version of its part (`PUT /jobs/:id/part`); its sweep re-runs. */
  "job.part_changed": z.looseObject({ partHash: z.string().min(1) }),
  /** The job failed; `message` is safe to show. */
  "job.error": z.looseObject({ message: z.string() }),
  /** The server runs a new engine; open tabs should reload. Org-wide (no job). */
  "engine.updated": z.looseObject({ engineVersion: z.string().min(1) }),
} as const;

export type CrateEventType = keyof typeof EVENT_PAYLOADS;
export const CRATE_EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as [CrateEventType, ...CrateEventType[]];
export const CrateEventTypeSchema = z.enum(CRATE_EVENT_TYPES);
export type CrateEventPayload<T extends CrateEventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;

/** Validates `payload` for `type` and its size. Throws a ZodError (or RangeError) when it doesn't fit. */
export function parseEventPayload<T extends CrateEventType>(type: T, payload: unknown): CrateEventPayload<T> {
  const parsed = EVENT_PAYLOADS[type].parse(payload) as CrateEventPayload<T>;
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).length;
  if (bytes > MAX_EVENT_PAYLOAD_BYTES) {
    throw new RangeError(`Event payload for ${type} is ${bytes} bytes; the limit is ${MAX_EVENT_PAYLOAD_BYTES}. Send ids, not data.`);
  }
  return parsed;
}

/** What the NOTIFY trigger sends (db/migrations/0002_event_notify.sql). */
export const EventNotificationSchema = z.object({
  id: z.number().int().positive(),
  orgId: id,
  jobId: id.nullable(),
  type: z.string(),
});
export type EventNotification = z.infer<typeof EventNotificationSchema>;

/**
 * One SSE message's `data` on `GET /api/v1/events?job=…`. The SSE `id:` field is the same `id`,
 * which the browser sends back as `Last-Event-ID` when it reconnects. `jobId` is null for
 * org-wide events (`engine.updated`).
 */
export const JobEventMessageSchema = z.object({
  id: z.number().int().positive(),
  jobId: id.nullable(),
  type: CrateEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type JobEventMessage = z.infer<typeof JobEventMessageSchema>;
