// POST /api/v1/jobs/:id/configs: save a configuration designed in the browser (#46). The server
// recomputes it with the engine before storing it. Shapes: src/lib/api/jobs.ts; docs/API.md.
import { callerOrg } from "@/server/auth";
import { getDb } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { saveConfiguration } from "@/server/jobs";

// The engine runs here (~2 ms per design), with postgres.js: Node only.
export const runtime = "nodejs";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/jobs/[id]/configs">): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { status, body } = await saveConfiguration(id, request, { db: getDb(), org: callerOrg(request) });
    return json(body, status);
  } catch (e) {
    return errorResponse(e, "POST /api/v1/jobs/:id/configs");
  }
}
