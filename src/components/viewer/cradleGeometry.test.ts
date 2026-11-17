import { EdgesGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { cradleGeometry } from "./cradleGeometry";

describe("cradleGeometry (#6)", () => {
  const d = computeDesign(getPart("PART-002"), { ...DEFAULT_SETTINGS, quantity: 4 }).design!;
  const cradles = d.members.filter((m) => m.kind === "cradle");

  it("fills each cradle's bounding box, centred on it", () => {
    expect(cradles.length).toBeGreaterThan(0);
    for (const m of cradles) {
      const g = cradleGeometry(m);
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(new Vector3());
      const centre = g.boundingBox!.getCenter(new Vector3());
      expect(size.x).toBeCloseTo(m.size[0], 3);
      expect(size.y).toBeCloseTo(m.size[1], 3);
      expect(size.z).toBeCloseTo(m.size[2], 3);
      for (const v of [centre.x, centre.y, centre.z]) expect(Math.abs(v)).toBeLessThan(1e-6);
    }
  });

  it("is cut down to the notch bottom at the notch centre", () => {
    const m = cradles.find((c) => c.label === "Cradle")!;
    const n = m.cradle!.notches[0];
    const g = cradleGeometry(m);
    const pos = g.getAttribute("position");
    const y = n.center - (m.min[1] + m.size[1] / 2);
    const tops = Array.from({ length: pos.count }, (_, i) => new Vector3().fromBufferAttribute(pos, i))
      .filter((p) => Math.abs(p.y - y) < 1e-6 && p.z > -m.size[2] / 2 + 1)
      .map((p) => p.z);
    expect(Math.min(...tops)).toBeCloseTo(m.size[2] / 2 - n.depth, 3);
    expect(new EdgesGeometry(g, 20).getAttribute("position").count).toBeGreaterThan(0);
  });
});
