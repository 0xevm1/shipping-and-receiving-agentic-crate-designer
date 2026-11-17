// PUT /api/v1/jobs/:id/part: the part as the browser's engine designs it, with its measured
// outline (#46 "same inputs"). Shapes: src/lib/api/jobs.ts; reference: docs/API.md.
import { callerOrg } from "@/server/auth";
import { getDb } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { putJobPart } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, ctx: RouteContext<"/api/v1/jobs/[id]/part">): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { status, body } = await putJobPart(id, request, { db: getDb(), org: callerOrg(request) });
    return json(body, status);
  } catch (e) {
    return errorResponse(e, "PUT /api/v1/jobs/:id/part");
  }
}
