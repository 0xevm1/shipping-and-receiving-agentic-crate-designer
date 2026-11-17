import { Box3, Euler, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ORIENTATIONS, rotatedSize, rotationMatrix } from "./orientations";
import type { Vec3 } from "./schema";

/**
 * The only domain test that imports three.js (ESLint allows it here and nowhere else in
 * `src/domain`): it checks the domain's integer rotations against the library the viewer
 * renders with, so the two cannot drift apart.
 */
describe("orientations match three.js", () => {
  it("rotatedSize equals three.js's rotated bounding box", () => {
    for (const size of [
      [1, 2, 3],
      [1530.25, 172, 90.5],
      [40, 40, 40],
    ] as Vec3[]) {
      for (const o of ORIENTATIONS) {
        const half = new Vector3(...size).multiplyScalar(0.5);
        const box = new Box3(half.clone().negate(), half).applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...o.euler)));
        const three = box.getSize(new Vector3());
        const expected = [three.x, three.y, three.z].map((v) => Math.round(v * 1000) / 1000);
        expect(rotatedSize(size, o)).toEqual(expected);
      }
    }
  });

  it("rotationMatrix equals three.js's for every orientation", () => {
    for (const o of ORIENTATIONS) {
      const e = new Matrix4().makeRotationFromEuler(new Euler(...o.euler)).elements; // column-major
      const m = rotationMatrix(o);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m[r][c]).toBeCloseTo(e[c * 4 + r], 9);
    }
  });
});
