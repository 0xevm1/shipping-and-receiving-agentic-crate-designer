import { Box3, Vector3, type BufferGeometry, type Mesh, type Object3D } from "three";
import { FACE_AXES, type FaceDepth, type FaceId, type PartProfile } from "@/domain/profile";
import type { Vec3 } from "@/domain/schema";

/**
 * Measures a part profile (spec §7.5b) from its mesh: for each of the 6 faces of the
 * bounding box, the depth from that face inward to the first surface, on a grid.
 *
 * Instead of casting one ray per cell, every triangle is rasterised onto the 3 axis planes at
 * the cell centres (a depth buffer), keeping the nearest surface from each side. That is
 * O(triangles × cells covered), a few milliseconds for the sample parts. Runs in the browser once
 * per model, after the crate first renders (`scheduleProfile`), and in Node in the tests.
 */

/** Grid spacing: about 1/100 of the longest side, at least 2 mm, rounded up to 0.5 mm. */
export function profileCellMm(sizeMm: Vec3): number {
  return Math.max(2, Math.ceil((Math.max(...sizeMm) / 100) * 2) / 2);
}

/** Analysis that runs longer than this is abandoned, and blocking stays on the bounding box. */
const PROFILE_BUDGET_MS = 1000;

/**
 * Builds the profile of a loaded model. `mmPerUnit` is 1000 for metre files. Throws if the model
 * has no triangles or analysis runs past `budgetMs`.
 */
export function buildPartProfile(scene: Object3D, mmPerUnit: number, budgetMs = PROFILE_BUDGET_MS): PartProfile {
  const started = now();
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const min = box.min.clone().multiplyScalar(mmPerUnit);
  const sizeMm = box.getSize(new Vector3()).multiplyScalar(mmPerUnit).toArray() as Vec3;
  if (!sizeMm.every((v) => v > 0)) throw new Error("The model has no solid geometry.");

  // Every triangle, in mm from the bounding box's min corner.
  const tris: number[] = [];
  const v = new Vector3();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as BufferGeometry;
    const pos = geometry.getAttribute("position");
    if (!pos) return;
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k)
          .applyMatrix4(mesh.matrixWorld)
          .multiplyScalar(mmPerUnit)
          .sub(min);
        tris.push(v.x, v.y, v.z);
      }
    }
  });
  if (!tris.length) throw new Error("The model has no triangles.");

  const cellMm = profileCellMm(sizeMm);
  const faces = {} as Record<FaceId, FaceDepth>;
  for (const axis of [0, 1, 2] as const) {
    const [ua, va] = FACE_AXES[axis];
    const cols = Math.max(1, Math.round(sizeMm[ua] / cellMm));
    const rows = Math.max(1, Math.round(sizeMm[va] / cellMm));
    const su = sizeMm[ua] / cols;
    const sv = sizeMm[va] / rows;
    // Nearest surface from the low face (smallest coordinate) and from the high face (largest).
    const near = new Float64Array(cols * rows).fill(Infinity);
    const far = new Float64Array(cols * rows).fill(-Infinity);
    for (let t = 0; t < tris.length; t += 9) {
      if ((t & 0xfff) === 0 && now() - started > budgetMs) throw new Error("Part analysis took too long.");
      const [u0, v0, n0, u1, v1, n1, u2, v2, n2] = [
        tris[t + ua],
        tris[t + va],
        tris[t + axis],
        tris[t + 3 + ua],
        tris[t + 3 + va],
        tris[t + 3 + axis],
        tris[t + 6 + ua],
        tris[t + 6 + va],
        tris[t + 6 + axis],
      ];
      const area = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(area) < 1e-9) continue; // edge-on to this axis
      const cMin = Math.max(0, Math.ceil(Math.min(u0, u1, u2) / su - 0.5));
      const cMax = Math.min(cols - 1, Math.floor(Math.max(u0, u1, u2) / su - 0.5));
      const rMin = Math.max(0, Math.ceil(Math.min(v0, v1, v2) / sv - 0.5));
      const rMax = Math.min(rows - 1, Math.floor(Math.max(v0, v1, v2) / sv - 0.5));
      const eps = -1e-7 * Math.abs(area);
      for (let r = rMin; r <= rMax; r++) {
        const pv = (r + 0.5) * sv;
        for (let c = cMin; c <= cMax; c++) {
          const pu = (c + 0.5) * su;
          // Barycentric weights, scaled by the signed area.
          const w0 = (u1 - pu) * (v2 - pv) - (u2 - pu) * (v1 - pv);
          const w1 = (u2 - pu) * (v0 - pv) - (u0 - pu) * (v2 - pv);
          const w2 = area - w0 - w1;
          if (area > 0 ? w0 < eps || w1 < eps || w2 < eps : w0 > -eps || w1 > -eps || w2 > -eps) continue;
          const n = (w0 * n0 + w1 * n1 + w2 * n2) / area;
          const i = r * cols + c;
          if (n < near[i]) near[i] = n;
          if (n > far[i]) far[i] = n;
        }
      }
    }
    const depth = (values: Float64Array, fromHigh: boolean) =>
      Array.from(values, (n) => (Number.isFinite(n) ? Math.max(0, Math.round((fromHigh ? sizeMm[axis] - n : n) * 10) / 10) : -1));
    const name = "xyz"[axis];
    faces[`-${name}` as FaceId] = { cols, rows, depth: depth(near, false) };
    faces[`+${name}` as FaceId] = { cols, rows, depth: depth(far, true) };
  }
  return { version: 1, sizeMm: sizeMm.map((s) => Math.round(s * 1000) / 1000) as Vec3, cellMm, faces };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Profiles by model URL, so a part analysed once is not analysed again in this session. */
const profiles = new Map<string, PartProfile | null>();

let lastMs: number | null = null;

/** Milliseconds the last analysis took, for the e2e probe; null before any. */
export const lastProfileMs = (): number | null => lastMs;

/**
 * Analyses the model off the critical path (when the browser is idle, after the crate has
 * rendered) and hands the profile to `onDone`, or null if analysis failed or ran out of time.
 * Cached per model URL. Returns a cancel function.
 */
export function scheduleProfile(url: string, scene: Object3D, mmPerUnit: number, onDone: (url: string, profile: PartProfile | null) => void): () => void {
  if (profiles.has(url)) {
    onDone(url, profiles.get(url)!);
    return () => {};
  }
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    const started = now();
    let profile: PartProfile | null = null;
    try {
      profile = buildPartProfile(scene, mmPerUnit);
    } catch (e) {
      console.warn("Part analysis failed; blocking follows the bounding box.", e);
    }
    lastMs = now() - started;
    profiles.set(url, profile);
    onDone(url, profile);
  };
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 1500 });
    return () => {
      cancelled = true;
      w.cancelIdleCallback!(id);
    };
  }
  const id = setTimeout(run, 50);
  return () => {
    cancelled = true;
    clearTimeout(id);
  };
}
