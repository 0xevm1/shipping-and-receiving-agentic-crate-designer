// POST /api/v1/jobs: open a design job for a part, or reuse its open one (#46). Shapes:
// src/lib/api/jobs.ts; reference: docs/API.md. Logic: src/server/jobs.
import { callerOrg } from "@/server/auth";
import { getDb } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { createJob } from "@/server/jobs";

// postgres.js and node:crypto need Node.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const { status, body } = await createJob(request, { db: getDb(), org: callerOrg(request) });
    return json(body, status, status === 201 ? { Location: `/api/v1/jobs/${body.job.id}` } : {});
  } catch (e) {
    return errorResponse(e, "POST /api/v1/jobs");
  }
}
