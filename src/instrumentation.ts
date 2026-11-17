// Runs once when a Next.js server starts (node_modules/next/dist/docs, "instrumentation.js").
// Announces a new engine to open tabs (#46 §3, docs/POSTGRES.md "Engine updates"). Not awaited:
// startup never waits on the database, and the announcement doesn't need to beat the first request.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` may load this file; it has no database.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { announceEngineOnStart } = await import("./server/engine/announce");
  void announceEngineOnStart();
}
