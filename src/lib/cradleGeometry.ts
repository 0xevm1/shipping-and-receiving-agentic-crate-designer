import { ExtrudeGeometry, Matrix4, Shape, Vector2, type BufferGeometry } from "three";
import { cradleProfile } from "@/domain/cradles";
import type { Member } from "@/domain/crate";

/**
 * A notched cradle as a solid: its profile (`cradleProfile`) extruded through the board's
 * thickness. Domain mm, centred on the member's bounding-box centre, so it drops in where the
 * viewer's unit box would go (at scale 1 instead of scale = size).
 */
export function cradleGeometry(m: Pick<Member, "min" | "size" | "cradle">): BufferGeometry {
  const axis = m.cradle?.axis ?? 1;
  const ca = m.min[axis] + m.size[axis] / 2;
  const cz = m.min[2] + m.size[2] / 2;
  const thick = m.size[axis === 1 ? 0 : 1];
  const shape = new Shape(cradleProfile(m).map(([a, z]) => new Vector2(a - ca, z - cz)));
  const g = new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -thick / 2);
  // Shape x → the board's length axis, shape y → Z, extrusion → the thickness axis. Both maps are rotations (det +1).
  const toDomain =
    axis === 1
      ? new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1) // X = depth, Y = x, Z = y
      : new Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1); // X = x, Y = −depth, Z = y
  g.applyMatrix4(toDomain);
  return g;
}
