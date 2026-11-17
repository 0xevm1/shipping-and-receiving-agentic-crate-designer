// GET /api/v1/events?job=<id> (#46 §3): a job's events as Server-Sent Events, resumable with
// Last-Event-ID. The logic, and the order that keeps it gap-free, is in src/server/events/sse.ts.
import { DEFAULT_ORG, getRepository } from "@/server/db";
import { getEventBus, handleJobEventsRequest } from "@/server/events";

// A long-lived stream holding a LISTEN-backed subscription: Node.js only, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  // No accounts yet: every caller acts for the default org (#60). The handler still checks that
  // the job belongs to this org before it subscribes.
  return handleJobEventsRequest(request, { ctx: DEFAULT_ORG, repo: getRepository(), bus: getEventBus() });
}
