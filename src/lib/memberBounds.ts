import { memberBounds as bounds, type Member } from "@/domain/members";
import type { Vec3 } from "@/domain/schema";

/**
 * The box around a set of members and its centre, in the design's crate-interior mm, for the GLB
 * export and the shipping label. The box is the domain's `memberBounds`; this adds the centre.
 */
export function memberBounds(members: readonly Pick<Member, "min" | "size">[]): { min: Vec3; max: Vec3; centre: Vec3 } {
  const { min, max } = bounds(members);
  return { min, max, centre: [0, 1, 2].map((i) => (min[i] + max[i]) / 2) as Vec3 };
}
