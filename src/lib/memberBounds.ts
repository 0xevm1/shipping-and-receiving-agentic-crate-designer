import type { Member } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";

/**
 * The box around a set of members, in the design's crate-interior mm. One helper for the GLB
 * export, the shipping label and the drawings; the domain keeps its own for its own use, so
 * this is the one to swap for it when the two meet.
 */
export function memberBounds(members: readonly Pick<Member, "min" | "size">[]): { min: Vec3; max: Vec3; centre: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const m of members) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], m.min[i]);
      max[i] = Math.max(max[i], m.min[i] + m.size[i]);
    }
  }
  return { min, max, centre: [0, 1, 2].map((i) => (min[i] + max[i]) / 2) as Vec3 };
}
