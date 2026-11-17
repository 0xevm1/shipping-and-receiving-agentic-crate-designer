// GET /api/v1/standards (the org's shop rates and limits) and PUT /api/v1/standards (a new
// version, optimistic on `baseVersion`) (#46, #19). Shapes: src/lib/api/standards.ts; reference: docs/API.md.
import { callerOrg } from "@/server/auth";
import { getRepository } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { putOrgStandards, readOrgStandards } from "@/server/standards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return json(await readOrgStandards(getRepository(), callerOrg(request)));
  } catch (e) {
    return errorResponse(e, "GET /api/v1/standards");
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    return json(await putOrgStandards(request, getRepository(), callerOrg(request)));
  } catch (e) {
    return errorResponse(e, "PUT /api/v1/standards");
  }
}
