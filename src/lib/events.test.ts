import { describe, expect, it } from "vitest";
import { CRATE_EVENT_TYPES, EventNotificationSchema, JobEventMessageSchema, MAX_EVENT_PAYLOAD_BYTES, parseEventPayload } from "./events";

const ID = "00000000-0000-4000-8000-000000000001";

describe("event types", () => {
  it("lists the first-cut types from #46 §3", () => {
    expect([...CRATE_EVENT_TYPES].sort()).toEqual(
      ["artifact.ready", "config.added", "configs.ready", "engine.updated", "job.created", "job.error", "part.created", "recommendation.changed"].sort(),
    );
  });

  it("validates a payload against its type and keeps extra fields", () => {
    expect(parseEventPayload("config.added", { configurationId: ID, inputHash: "abc", note: 1 })).toEqual({ configurationId: ID, inputHash: "abc", note: 1 });
    expect(() => parseEventPayload("config.added", { configurationId: "nope", inputHash: "abc" })).toThrow();
    expect(() => parseEventPayload("configs.ready", {})).toThrow();
  });

  it("refuses a payload over the size cap", () => {
    expect(() => parseEventPayload("job.error", { message: "x".repeat(MAX_EVENT_PAYLOAD_BYTES) })).toThrow(RangeError);
  });

  it("parses the trigger's notification and the SSE message", () => {
    expect(EventNotificationSchema.parse({ id: 7, orgId: ID, jobId: null, type: "engine.updated" }).id).toBe(7);
    const message = { id: 8, jobId: ID, type: "job.error", payload: { message: "boom" }, createdAt: "2026-01-01T00:00:00.000Z" };
    expect(JobEventMessageSchema.parse(message)).toEqual(message);
    expect(JobEventMessageSchema.safeParse({ ...message, type: "made.up" }).success).toBe(false);
  });
});
