import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { parts } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { buildCogEstimate } from "./partCog";
import { catalogPart } from "./part";

/**
 * What the mesh estimate does to the three sample parts' crates (#110): the centre of gravity moves a
 * little, no check level changes, and the crate (layout, size, weight, boards) is the same as with the
 * assumed centre. The numbers in the PR's before/after table come from here.
 */
async function estimated(file: string) {
  const b = readFileSync(`public/parts/${file}`);
  const scene = (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "")).scene;
  const r = buildCogEstimate(scene, 1000);
  if (!("offsetMm" in r)) throw new Error(`no estimate: ${r.fallback}`);
  return r.offsetMm;
}

describe("the sample parts with their estimated centre of gravity", () => {
  it.each(parts.flatMap((p) => p.suggested_quantities.map((quantity) => [p.id, quantity] as const)))(
    "%s × %i: same crate, no check changes level",
    async (id, quantity) => {
      const part = catalogPart(parts.find((p) => p.id === id)!);
      const offsetMm = await estimated(part.model!);
      const settings = { ...DEFAULT_SETTINGS, quantity };
      const before = computeDesign(part, settings).design!;
      const after = computeDesign({ ...part, cog: { offsetMm, source: "estimated" } }, settings).design!;
      expect(after.layout.key).toBe(before.layout.key);
      expect(after.layout.external).toEqual(before.layout.external);
      expect(after.grossKg).toBe(before.grossKg);
      expect(after.bom).toEqual(before.bom);
      const level = (d: typeof before) => d.checks.map((c) => `${c.id}:${c.level}`);
      expect(level(after)).toEqual(level(before));
      // Under the thresholds: the off-centre limit (a tenth of the length and width) and the tip-angle limit.
      const std = 0.1;
      expect(Math.abs(after.handling.offsetMm[0])).toBeLessThan(std * after.handling.footprintMm[0]);
      expect(Math.abs(after.handling.offsetMm[1])).toBeLessThan(std * after.handling.footprintMm[1]);
    },
  );
});
