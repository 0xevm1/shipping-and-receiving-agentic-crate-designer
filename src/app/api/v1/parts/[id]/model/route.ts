// GET /api/v1/parts/:id/model: a ~5 min presigned GET URL for the part's GLB (#46), as JSON, or a
// 302 to it with `?redirect=1` (for an <a href> or a loader that follows redirects).
import { getBlobStore } from "@/server/blob";
import { DEFAULT_ORG, getDb } from "@/server/db";
import { errorResponse, json, NO_STORE } from "@/server/http";
import { partModelUrl } from "@/server/parts/model";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/parts/[id]/model">): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const model = await partModelUrl(id, { db: getDb(), blob: getBlobStore(), org: DEFAULT_ORG });
    if (new URL(request.url).searchParams.get("redirect") === "1") {
      return new Response(null, { status: 302, headers: { ...NO_STORE, Location: model.url } });
    }
    return json(model);
  } catch (e) {
    return errorResponse(e, "GET /api/v1/parts/:id/model");
  }
}
