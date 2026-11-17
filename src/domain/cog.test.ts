import { describe, expect, it } from "vitest";
import { clampToBox, cogBasisOf, cogInsideBox, cogOffsetOf, estimateCog } from "./cog";
import { cogFromFile, offsetToDesign, offsetToFile, reframeOffset } from "./partFrame";
import type { Vec3 } from "./schema";

/** The 12 triangles of an axis-aligned box, wound outward. */
export function boxTriangles(min: Vec3, max: Vec3): number[] {
  const out: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
    for (const side of [0, 1]) {
      const corner = (du: number, dv: number): number[] => {
        const p = [0, 0, 0];
        p[axis] = side ? max[axis] : min[axis];
        p[u] = du ? max[u] : min[u];
        p[v] = dv ? max[v] : min[v];
        return p;
      };
      // (u, v, axis) is a right-handed frame, so u × v points along +axis: counter-clockwise seen from +axis.
      const quad = side ? [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)] : [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0)];
      out.push(...quad[0], ...quad[1], ...quad[2], ...quad[0], ...quad[2], ...quad[3]);
    }
  }
  return out;
}

describe("estimateCog", () => {
  it("puts a closed box's centre at the middle of its bounding box", () => {
    const r = estimateCog(boxTriangles([100, 200, 300], [400, 260, 380]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      r.offsetMm.forEach((v) => expect(v).toBeCloseTo(0, 6));
      expect(r.volumeMm3).toBeCloseTo(300 * 60 * 80, 3);
    }
  });

  it("finds the known centroid of an L-shape (two boxes sharing a face)", () => {
    // 200x100x100 plus 100x100x100 on top of one end of its Y side: centroid (83.33, 83.33, 50), box centre (100, 100, 50).
    const tris = [...boxTriangles([0, 0, 0], [200, 100, 100]), ...boxTriangles([0, 100, 0], [100, 200, 100])];
    const r = estimateCog(tris);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offsetMm[0]).toBeCloseTo(-50 / 3, 6);
      expect(r.offsetMm[1]).toBeCloseTo(-50 / 3, 6);
      expect(r.offsetMm[2]).toBeCloseTo(0, 6);
    }
  });

  it("does not depend on where the model sits", () => {
    const near = estimateCog([...boxTriangles([0, 0, 0], [200, 100, 100]), ...boxTriangles([0, 100, 0], [100, 200, 100])]);
    const far = estimateCog([...boxTriangles([5000, -3000, 700], [5200, -2900, 800]), ...boxTriangles([5000, -2900, 700], [5100, -2800, 800])]);
    expect(far).toEqual(near);
  });

  it("weighs a heavy end more than a light one", () => {
    // A thick block (volume 8e6) and a thin one beside it (volume 1e6): the centre sits well toward the thick one.
    const r = estimateCog([...boxTriangles([0, 0, 0], [200, 200, 200]), ...boxTriangles([200, 75, 75], [300, 125, 125])]);
    expect(r.ok && r.offsetMm[0]).toBeLessThan(-20);
  });

  it("closes a mesh that has a vertex per face (split normals), within float noise", () => {
    const tris = boxTriangles([0, 0, 0], [300, 100, 100]).map((v) => v + 1e-7);
    const r = estimateCog(tris);
    expect(r.ok).toBe(true);
  });

  it("turns a mesh wound inside out the right way", () => {
    const tris = boxTriangles([0, 0, 0], [200, 100, 100]);
    const flipped: number[] = [];
    for (let t = 0; t < tris.length; t += 9) flipped.push(...tris.slice(t, t + 3), ...tris.slice(t + 6, t + 9), ...tris.slice(t + 3, t + 6));
    const r = estimateCog(flipped);
    expect(r.ok && r.offsetMm).toEqual([0, 0, 0].map((v) => expect.closeTo(v, 6)));
  });

  it("gives up on an open mesh (a face missing)", () => {
    const tris = boxTriangles([0, 0, 0], [200, 100, 100]).slice(0, 11 * 9);
    expect(estimateCog(tris)).toEqual({ ok: false, reason: "open" });
  });

  it("gives up on a box with faces missing (an open tube)", () => {
    expect(estimateCog(boxTriangles([0, 0, 0], [200, 100, 100]).slice(0, 8 * 9))).toEqual({ ok: false, reason: "open" });
  });

  it("gives up when bodies overlap so that their volume exceeds the box", () => {
    const one = boxTriangles([0, 0, 0], [100, 100, 100]);
    const r = estimateCog([...one, ...one, ...one]);
    expect(r).toEqual({ ok: false, reason: "unreliable" });
  });

  it("gives up on nothing", () => {
    expect(estimateCog([])).toEqual({ ok: false, reason: "empty" });
    expect(estimateCog([0, 0, 0, 1, 0, 0, 0, 1, 0])).toEqual({ ok: false, reason: "empty" });
    expect(estimateCog(boxTriangles([0, 0, 0], [1, 1, 1]).map((v, i) => (i === 4 ? Number.NaN : v)))).toEqual({ ok: false, reason: "empty" });
  });
});

describe("the centre of gravity as a part field", () => {
  it("reads as assumed at the centre without one", () => {
    expect(cogOffsetOf({})).toEqual([0, 0, 0]);
    expect(cogBasisOf({})).toBe("assumed");
    expect(cogBasisOf({ cog: { offsetMm: [1, 2, 3], source: "estimated" } })).toBe("estimated");
  });

  it("is inside the box to a hair's tolerance", () => {
    expect(cogInsideBox([50, 0, -25], [100, 10, 50])).toBe(true);
    expect(cogInsideBox([50.005, 0, 0], [100, 10, 50])).toBe(true);
    expect(cogInsideBox([50.5, 0, 0], [100, 10, 50])).toBe(false);
    expect(clampToBox([50.005, -9, 0], [100, 10, 50])).toEqual([50, -5, 0]);
  });
});

describe("frame conversions of an offset", () => {
  it("scales by the file's units", () => {
    expect(offsetToDesign([0.1, 0, -0.05], { units: "m", up: "z" })).toEqual([100, 0, -50]);
    expect(offsetToDesign([1, 2, 3], { units: "in", up: "z" })).toEqual([25.4, 50.8, 76.2]);
  });

  it("turns a Y-up file's offset the way the model is turned (x, y, z) to (x, -z, y)", () => {
    expect(offsetToDesign([1, 2, 3], { units: "mm", up: "y" })).toEqual([1, -3, 2]);
  });

  it("round-trips between the file and the design frame", () => {
    for (const frame of [
      { units: "m", up: "z" },
      { units: "in", up: "y" },
      { units: "mm", up: "y" },
    ] as const) {
      const back = offsetToFile(offsetToDesign([0.3, -0.2, 0.7], frame), frame);
      back.forEach((v, i) => expect(v).toBeCloseTo([0.3, -0.2, 0.7][i], 9));
    }
  });

  it("takes a parts.json cog_mm (mm, the model's axes and origin) to an offset from the box centre", () => {
    // A metre model whose box spans x 0.2 to 0.6 (centre 0.4 m = 400 mm): a cog_mm of 500 is 100 mm toward +X.
    expect(cogFromFile([500, 150, 50], [0.4, 0.15, 0.05], { units: "m", up: "z" })).toEqual([100, 0, 0]);
    // The same point written for a file in inches (centre 15.748 in).
    const [x] = cogFromFile([500, 0, 0], [400 / 25.4, 0, 0], { units: "in", up: "z" });
    expect(x).toBeCloseTo(100, 6);
  });

  it("takes a cog_mm of a Y-up model into the Z-up design frame", () => {
    // Y up, millimetres, box centred at (0, 50, 0). The cog is 30 mm along file +X, 20 above the middle (file +Y), 10 along file +Z.
    expect(cogFromFile([30, 70, 10], [0, 50, 0], { units: "mm", up: "y" })).toEqual([30, -10, 20]);
  });

  it("keeps the same point of the part when the file is read another way", () => {
    // A Y-up, inch reading: file offset (1, 2, 3) in → mm in the design frame. Read as Z up in mm instead: the same file numbers.
    const a = offsetToDesign([1, 2, 3], { units: "in", up: "y" });
    const b = reframeOffset(a, { units: "in", up: "y" }, { units: "mm", up: "z" });
    expect(b).toEqual([1, 2, 3]);
    expect(reframeOffset(b, { units: "mm", up: "z" }, { units: "in", up: "y" })).toEqual(a);
  });
});
