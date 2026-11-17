// POST /api/v1/designs: stateless headless calculation (#46 slice 7). Multipart GLB + the part's
// facts in, ranked configurations out, nothing saved. Shapes: src/lib/api/designs.ts; docs/QUEUE.md.
// Needs an API key (Authorization: Bearer) unless called from the app's own pages.
import { authenticate } from "@/server/auth/authenticate";
import { createApiKeyStore, getDb } from "@/server/db";
import { calculateDesigns } from "@/server/designs/calculate";
import { ApiFailure, errorResponse, json } from "@/server/http";
import { EngineWorkerMissingError, getEnginePool } from "@/server/workers/engine";

// node:crypto, worker_threads and postgres.js need Node.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await authenticate(request, { keys: createApiKeyStore(getDb()), requireKeyOutsideUi: true });
    let pool;
    try {
      pool = getEnginePool();
    } catch (e) {
      if (e instanceof EngineWorkerMissingError) console.error(e.message);
      throw new ApiFailure(503, "unavailable", "The design engine isn't running on this server. Try again shortly.");
    }
    return json(await calculateDesigns(request, { pool }));
  } catch (e) {
    return errorResponse(e, "POST /api/v1/designs");
  }
}
