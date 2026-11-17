/**
 * Runs `run` when the browser is idle (after the crate has rendered), or shortly after where there is
 * no idle callback (Node, the tests). Returns a cancel function. For analyses of a loaded model that
 * are not needed to draw it: the part's outline (`partProfile.ts`) and centre of gravity (`partCog.ts`).
 */
export function whenIdle(run: () => void, timeoutMs = 1500): () => void {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: timeoutMs });
    return () => w.cancelIdleCallback!(id);
  }
  const id = setTimeout(run, 50);
  return () => clearTimeout(id);
}
