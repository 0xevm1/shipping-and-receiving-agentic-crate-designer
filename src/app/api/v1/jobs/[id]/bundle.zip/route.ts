// GET /api/v1/jobs/:id/bundle.zip?configs=<id>,<id>,… (#46 slice 6): the one-click download from the
// server, a folder per configuration plus manifest.json and comparison.pdf (spec §7.17); default:
// every configuration of the job. Small bundles are built during the request on the engine's
// worker threads (200); larger ones are queued (202) and `artifact.ready` follows. JSON with a
// presigned URL, or a 302 to it with `?redirect=1` once ready. docs/API.md "Artifacts".
import { parseConfigsParam } from "@/lib/api/artifacts";
import { artifactsDeps, jobBundle } from "@/server/artifacts";
import { callerOrg } from "@/server/auth";
import { errorResponse, json, NO_STORE } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/jobs/[id]/bundle.zip">): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const params = new URL(request.url).searchParams;
    const { status, body } = await jobBundle(id, parseConfigsParam(params), artifactsDeps(callerOrg(request)));
    if (body.status === "ready" && params.get("redirect") === "1") {
      return new Response(null, { status: 302, headers: { ...NO_STORE, Location: body.url } });
    }
    const location = new URL(request.url);
    location.searchParams.delete("redirect");
    return json(body, status, status === 202 ? { Location: `${location.pathname}${location.search}`, "Retry-After": "5" } : {});
  } catch (e) {
    return errorResponse(e, "GET /api/v1/jobs/:id/bundle.zip");
  }
}
