// POST /api/v1/parts: upload a part's GLB with its mass, material, density and name (#46).
// Request and response shapes: src/lib/api/parts.ts. Runs as the default org until there is auth.
import { getBlobStore } from "@/server/blob";
import { DEFAULT_ORG, getDb } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { createPart } from "@/server/parts/create";

// node:crypto, the S3 SDK and postgres.js need Node.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const created = await createPart(request, { db: getDb(), blob: getBlobStore(), org: DEFAULT_ORG });
    return json(created, 201, { Location: `/api/v1/parts/${created.part.id}` });
  } catch (e) {
    return errorResponse(e, "POST /api/v1/parts");
  }
}
