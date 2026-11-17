// GET /api/v1/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv} (#46 slice 6): one of a saved
// configuration's files, built by the server's engine on the first request (on worker threads) and
// stored in blob storage. JSON with a ~5 min presigned URL, or a 302 to it with `?redirect=1`, as
// GET /parts/:id/model. Shapes: src/lib/api/artifacts.ts; docs/API.md "Artifacts".
import { artifactsDeps, configurationArtifact } from "@/server/artifacts";
import { callerOrg } from "@/server/auth";
import { errorResponse, json, NO_STORE } from "@/server/http";

// worker_threads, postgres.js and the S3 SDK need Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/jobs/[id]/configs/[cid]/[file]">): Promise<Response> {
  try {
    const { id, cid, file } = await ctx.params;
    const out = await configurationArtifact(id, cid, file, artifactsDeps(callerOrg(request)));
    if (new URL(request.url).searchParams.get("redirect") === "1") {
      return new Response(null, { status: 302, headers: { ...NO_STORE, Location: out.url } });
    }
    return json(out);
  } catch (e) {
    return errorResponse(e, "GET /api/v1/jobs/:id/configs/:cid/:file");
  }
}
