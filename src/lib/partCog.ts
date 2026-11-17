import { Vector3, type BufferGeometry, type Mesh, type Object3D } from "three";
import { estimateCog, type CogFallback } from "@/domain/cog";
import { whenIdle } from "./idle";
import { models } from "./modelRegistry";

/**
 * Estimates a loaded part's centre of gravity from its mesh (spec §7.14, #110): the volume-weighted
 * centroid of its closed bodies (`estimateCog` in the domain does the arithmetic). It runs in the
 * browser, because the browser is the side that holds the mesh; the answer is stored on the part
 * (`part.cog`, source "estimated") and sent to the server with the job's part, so the server's
 * sweeps and recomputed saves use the same centre without parsing the GLB.
 *
 * Like the outline (`partProfile.ts`) it runs once per model and frame, when the browser is idle after
 * the crate first renders, and is kept with the model (`models.memo`).
 */

/** What the estimate came to: an offset from the middle of the part's bounding box (mm, Z up), or why not. */
export type CogOutcome = { offsetMm: [number, number, number] } | { fallback: CogFallback | "failed" };

/** Every triangle of the model in mm (it is already Z up, `framedScene`): 9 numbers each. */
export function meshTrianglesMm(scene: Object3D, mmPerUnit: number): Float64Array {
  scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  let count = 0;
  scene.traverse((o) => {
    const mesh = o as Mesh;
    const geometry = mesh.isMesh ? (mesh.geometry as BufferGeometry) : null;
    if (!geometry?.getAttribute("position")) return;
    meshes.push(mesh);
    count += Math.floor((geometry.getIndex()?.count ?? geometry.getAttribute("position").count) / 3);
  });
  const out = new Float64Array(count * 9);
  const v = new Vector3();
  let at = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry as BufferGeometry;
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const n = Math.floor((index?.count ?? pos.count) / 3) * 3;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i)
        .applyMatrix4(mesh.matrixWorld)
        .multiplyScalar(mmPerUnit);
      out[at++] = v.x;
      out[at++] = v.y;
      out[at++] = v.z;
    }
  }
  return out;
}

/** The centre of gravity of a loaded model (Z up, `mmPerUnit` mm per unit), as an offset from its bounding-box centre. */
export function buildCogEstimate(scene: Object3D, mmPerUnit: number): CogOutcome {
  // The offset is from the middle of the triangles' own bounding box, which is the box the part is centred on.
  const r = estimateCog(meshTrianglesMm(scene, mmPerUnit));
  // To 0.01 mm, like the size: a file's float32 digits (a model far from its origin) must not show in the number.
  return r.ok ? { offsetMm: r.offsetMm.map((v) => Math.round(v * 100) / 100 + 0) as [number, number, number] } : { fallback: r.reason };
}

let lastMs: number | null = null;

/** Milliseconds the last estimate took, for the e2e probe and measurements; null before any. */
export const lastCogMs = (): number | null => lastMs;

/**
 * Estimates the model's centre of gravity off the critical path and hands it to `onDone`. Cached per
 * model URL and `frame` (the units and up axis it was measured in, as `scheduleProfile`). Returns a
 * cancel function.
 */
export function scheduleCog(url: string, scene: Object3D, mmPerUnit: number, onDone: (url: string, outcome: CogOutcome) => void, frame = ""): () => void {
  // The same per-model map the profile uses; its keys are frames, these start "cog:".
  const memo = models.memo<CogOutcome>(url);
  const key = `cog:${frame}`;
  if (memo.has(key)) {
    onDone(url, memo.get(key)!);
    return () => {};
  }
  let cancelled = false;
  const cancel = whenIdle(() => {
    if (cancelled) return;
    const started = performance.now();
    let outcome: CogOutcome;
    try {
      outcome = buildCogEstimate(scene, mmPerUnit);
    } catch (e) {
      console.warn("Centre of gravity estimate failed; it is assumed at the middle of the part's box.", e);
      outcome = { fallback: "failed" };
    }
    lastMs = performance.now() - started;
    memo.set(key, outcome);
    onDone(url, outcome);
  });
  return () => {
    cancelled = true;
    cancel();
  };
}
