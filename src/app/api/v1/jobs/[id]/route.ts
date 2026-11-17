// GET /api/v1/jobs/:id (snapshot) and PATCH /api/v1/jobs/:id (selection, status, notes; optimistic
// on `version`) (#46). Shapes: src/lib/api/jobs.ts; reference: docs/API.md.
import { callerOrg } from "@/server/auth";
import { getDb } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { getJobSnapshot, patchJob } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/jobs/[id]">): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return json(await getJobSnapshot(id, { db: getDb(), org: callerOrg(request) }));
  } catch (e) {
    return errorResponse(e, "GET /api/v1/jobs/:id");
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/jobs/[id]">): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { status, body } = await patchJob(id, request, { db: getDb(), org: callerOrg(request) });
    return json(body, status);
  } catch (e) {
    return errorResponse(e, "PATCH /api/v1/jobs/:id");
  }
}
