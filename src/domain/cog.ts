import { z } from "zod";
import type { Vec3 } from "./schema";

/**
 * A part's own centre of gravity (spec §7.14, #110). The crate's centre of gravity sums the parts'
 * masses at their actual centres, so where the weight sits inside the part matters for the
 * off-centre check, the tip angle and the fork positions.
 *
 * The centre is kept as an offset from the middle of the part's bounding box, in mm, in the part's
 * own design frame (Z up, as modelled, before the layout turns it). That is the one form every
 * source reduces to at the edge: a `cog_mm` in a parts.json (the model's own axes and origin), an
 * edit in Part details, or the mesh estimate (`estimateCog`).
 */

/** Who gave the centre: the file or the person ("supplied"), or the mesh ("estimated"). No centre at all is "assumed". */
const COG_SOURCES = ["supplied", "estimated"] as const;
export type CogSource = (typeof COG_SOURCES)[number];
/** What the CoG check says it used: a `CogSource`, or the bounding-box centre when there is none. */
export type CogBasis = CogSource | "assumed";

export interface PartCog {
  /** Offset from the middle of the bounding box, mm, [x, y, z] of the part as modelled (Z up). */
  offsetMm: Vec3;
  source: CogSource;
}

const FiniteSchema = z.number().finite();
export const PartCogSchema = z.object({
  offsetMm: z.tuple([FiniteSchema, FiniteSchema, FiniteSchema]),
  source: z.enum(COG_SOURCES),
});

/** How far past the box edge an offset may sit before it is not a point of the part (float noise). */
const COG_EDGE_TOLERANCE_MM = 0.01;

/** True when the offset lies inside a box of `size` centred on the origin. */
export const cogInsideBox = (offset: Vec3, size: Vec3): boolean => offset.every((v, i) => Math.abs(v) <= size[i] / 2 + COG_EDGE_TOLERANCE_MM);

/** The offset held to the box: a value a hair outside (float noise) is brought onto the face. */
export const clampToBox = (offset: Vec3, size: Vec3): Vec3 => offset.map((v, i) => Math.max(-size[i] / 2, Math.min(size[i] / 2, v))) as Vec3;

/** The offset the layout uses: the part's own, or none (the box centre) when no centre is known. */
export const cogOffsetOf = (part: { cog?: PartCog }): Vec3 => part.cog?.offsetMm ?? [0, 0, 0];

/** What the CoG check names as the source. */
export const cogBasisOf = (part: { cog?: PartCog }): CogBasis => part.cog?.source ?? "assumed";

/** Why a mesh gave no centre: its surface has holes (`open`), or the answer failed a sanity check (`unreliable`). */
export type CogFallback = "open" | "unreliable" | "empty";
export type CogEstimate = { ok: true; offsetMm: Vec3; volumeMm3: number } | { ok: false; reason: CogFallback };

/**
 * Estimates the centre of gravity of a mesh as the volume-weighted centroid of its closed bodies:
 * each triangle with the origin makes a signed tetrahedron, and the centroid of the sum is the
 * centroid of the solid (the divergence theorem). It assumes uniform density, which is as much as
 * a mesh can say; the mass is never taken from it.
 *
 * `triangles` holds 9 numbers per triangle (three vertices, x y z each), in mm in any origin.
 * The answer is the offset from the middle of the bounding box, or why not:
 * - `open`: some edge isn't shared by faces that meet it from opposite directions (a hole, a
 *   missing cap, a single sheet), so the signed volumes don't describe a solid;
 * - `unreliable`: the volume is zero or more than the box holds (bodies overlapping each other add
 *   twice), or the centroid falls outside the box. A mesh wound inside out is turned the right way;
 * - `empty`: no usable triangles.
 * Vertices closer than a millionth of the box's diagonal are the same point, so a mesh exported
 * with a vertex per face (split normals) still closes.
 */
export function estimateCog(triangles: ArrayLike<number>): CogEstimate {
  const count = Math.floor(triangles.length / 9);
  if (count < 4) return { ok: false, reason: "empty" };

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count * 9; i++) {
    const v = triangles[i];
    if (!Number.isFinite(v)) return { ok: false, reason: "empty" };
    const a = i % 3;
    if (v < lo[a]) lo[a] = v;
    if (v > hi[a]) hi[a] = v;
  }
  const size = hi.map((h, a) => h - lo[a]) as Vec3;
  const mid = hi.map((h, a) => (h + lo[a]) / 2);
  const diag = Math.hypot(size[0], size[1], size[2]);
  if (!(diag > 0)) return { ok: false, reason: "empty" };
  const tol = diag * 1e-6;

  // Weld the vertices, and add each triangle's edges: +1 along the low-to-high direction, -1 against it.
  const ids = new Map<string, number>();
  const idOf = (x: number, y: number, z: number): number => {
    const key = `${Math.round((x - mid[0]) / tol)},${Math.round((y - mid[1]) / tol)},${Math.round((z - mid[2]) / tol)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const balance = new Map<string, number>();
  const edge = (p: number, q: number) => {
    const key = p < q ? `${p}:${q}` : `${q}:${p}`;
    balance.set(key, (balance.get(key) ?? 0) + (p < q ? 1 : -1));
  };

  let volume = 0;
  const moment = [0, 0, 0];
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [
      triangles[o] - mid[0],
      triangles[o + 1] - mid[1],
      triangles[o + 2] - mid[2],
      triangles[o + 3] - mid[0],
      triangles[o + 4] - mid[1],
      triangles[o + 5] - mid[2],
      triangles[o + 6] - mid[0],
      triangles[o + 7] - mid[1],
      triangles[o + 8] - mid[2],
    ];
    const ia = idOf(triangles[o], triangles[o + 1], triangles[o + 2]);
    const ib = idOf(triangles[o + 3], triangles[o + 4], triangles[o + 5]);
    const ic = idOf(triangles[o + 6], triangles[o + 7], triangles[o + 8]);
    if (ia !== ib && ib !== ic && ic !== ia) {
      edge(ia, ib);
      edge(ib, ic);
      edge(ic, ia);
    }
    // Signed volume of the tetrahedron (origin, a, b, c), and its centroid (a + b + c) / 4 weighted by it.
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    volume += v;
    moment[0] += (v * (ax + bx + cx)) / 4;
    moment[1] += (v * (ay + by + cy)) / 4;
    moment[2] += (v * (az + bz + cz)) / 4;
  }

  for (const b of balance.values()) if (b !== 0) return { ok: false, reason: "open" };
  // Wound inside out: every body's volume is negative; the centroid is the same either way.
  const solid = Math.abs(volume);
  const boxVolume = size[0] * size[1] * size[2];
  if (!(solid > 0) || solid > boxVolume * 1.0001) return { ok: false, reason: "unreliable" };
  const offsetMm = moment.map((m) => m / volume) as Vec3;
  if (!cogInsideBox(offsetMm, size)) return { ok: false, reason: "unreliable" };
  return { ok: true, offsetMm: clampToBox(offsetMm, size), volumeMm3: solid };
}
