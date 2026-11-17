// GET /api/v1/health (#46): 200 when the database answers, 503 when it doesn't.
import { getSystemQueries } from "@/server/db";
import { peekEventBus } from "@/server/events";
import { checkHealth } from "@/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const health = await checkHealth(getSystemQueries(), peekEventBus());
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
