import { describe, expect, it } from "vitest";
import { metricText as metric } from "@/lib/message";
import { parts } from "./catalog";
import type { CrateDesign } from "./crate";
import { computeDesign, DEFAULT_SETTINGS, MAX_PART_MM, type DesignPart } from "./design";
import { CrateSettingsSchema, normalizeSettings, settingsAdjustments, type CrateSettings, type Vec3 } from "./schema";
import { DEFAULT_STANDARDS, minInteriorMm } from "./standards";

const MIN_INTERIOR_MM = minInteriorMm(DEFAULT_STANDARDS);

/** Edge cases and bad input: extremes must give a crate or a clear reason, never a crash. */

const part = (dimensions_mm: Vec3, mass_kg = 5): DesignPart => ({ id: "edge", name: "Edge part", mass_kg, dimensions_mm });
const run = (p: DesignPart, patch: Partial<CrateSettings> = {}) => computeDesign(p, { ...DEFAULT_SETTINGS, ...patch });

/** The crate is sound: boards fill exactly the external size, every board has real size, parts sit inside. */
function expectSound(d: CrateDesign) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of d.members) {
    m.size.forEach((s) => expect(s).toBeGreaterThan(0));
    for (let a = 0; a < 3; a++) {
      // Dunnage never pokes into the walls, floor or lid.
      if (m.assembly === "inside") {
        expect(m.min[a]).toBeGreaterThanOrEqual(-1e-6);
        expect(m.min[a] + m.size[a]).toBeLessThanOrEqual(d.layout.interior[a] + 1e-6);
      }
      min[a] = Math.min(min[a], m.min[a]);
      max[a] = Math.max(max[a], m.min[a] + m.size[a]);
    }
  }
  max.forEach((v, a) => expect(v - min[a]).toBeCloseTo(d.layout.external[a], 3));
  const { slots, cellSize, interior } = d.layout;
  for (const s of slots) {
    for (let a = 0; a < 3; a++) {
      expect(s.min[a]).toBeGreaterThanOrEqual(0);
      expect(s.min[a] + cellSize[a]).toBeLessThanOrEqual(interior[a] + 1e-6);
    }
  }
  expect(Number.isFinite(d.grossKg)).toBe(true);
  expect(Number.isFinite(d.screws)).toBe(true);
}

describe("quantity extremes", () => {
  const cases = parts.flatMap((p) =>
    [true, false].flatMap((keepUpright) => [1, 2, 3, 4].map((maxLayers) => [p.id, keepUpright, maxLayers] as const)),
  );

  it.each(cases)("%s at quantity 1 and 200 (upright %s, %i layers) packs every part, fast", (id, keepUpright, maxLayers) => {
    const p = parts.find((q) => q.id === id)!;
    for (const quantity of [1, 200]) {
      const settings = { quantity, keepUpright, maxLayers };
      const r = run(p, settings);
      expect(r.problem).toBeNull();
      expect(r.design!.layout.slots).toHaveLength(quantity);
      expectSound(r.design!);
      // Measured at 1–3 ms. A real regression is a 10× event, so the budget is generous, and
      // the median of several runs ignores one run stalled by a busy machine.
      expect(medianMs(() => run(p, settings))).toBeLessThan(50);
    }
  });
});

/** Median wall time of `TIMING_RUNS` calls, robust to a few runs slowed by GC or CPU load. */
const TIMING_RUNS = 5;
function medianMs(fn: () => unknown): number {
  const times: number[] = [];
  for (let i = 0; i < TIMING_RUNS; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(TIMING_RUNS / 2)];
}

describe("part size extremes", () => {
  it.each([
    ["1 mm cube", [1, 1, 1]],
    ["sub-millimetre", [0.001, 0.001, 0.001]],
    ["1 mm × 10 m rod", [10000, 1, 1]],
    ["10 m cube", [10000, 10000, 10000]],
  ] as [string, Vec3][])("a %s gets a sound crate at quantity 1 and 200", (_, dims) => {
    for (const quantity of [1, 200]) {
      for (const gap of [0, 50]) {
        const r = run(part(dims), { quantity, partGapMm: gap, wallClearanceMm: gap });
        expect(r.problem).toBeNull();
        expectSound(r.design!);
        r.design!.layout.interior.forEach((v) => expect(v).toBeGreaterThanOrEqual(MIN_INTERIOR_MM - 1e-6));
      }
    }
  });

  it("pads a tiny part to the smallest buildable crate, centred", () => {
    const { design: d } = run(part([1, 1, 1]), { quantity: 1, wallClearanceMm: 0 });
    expect(d!.layout.interior).toEqual([MIN_INTERIOR_MM, MIN_INTERIOR_MM, MIN_INTERIOR_MM]);
    expect(d!.layout.slots[0].min).toEqual([88.5, 88.5, 88.5]);
    expect(d!.layout.clearance).toEqual([88.5, 88.5, 88.5]);
  });

  it("flags a 10 m part as oversize freight", () => {
    const { design: d } = run(part([10000, 500, 500]), { quantity: 1 });
    expect(d!.checks.some((c) => c.id === "oversize")).toBe(true);
  });

  it.each([
    ["zero", [0, 100, 100]],
    ["negative", [100, -5, 100]],
    ["NaN", [100, 100, NaN]],
    ["infinite", [Infinity, 100, 100]],
  ] as [string, Vec3][])("rejects a %s dimension with a reason", (_, dims) => {
    const r = run(part(dims));
    expect(r.design).toBeNull();
    expect(r.layouts).toEqual([]);
    expect(r.problem?.id).toBe("part-size");
    expect(r.problem!.detail).toMatch(/\w/);
  });

  it("rejects a part longer than the limit, hinting at units", () => {
    const r = run(part([MAX_PART_MM + 1, 100, 100]));
    expect(r.design).toBeNull();
    expect(r.problem?.id).toBe("part-too-large");
    expect(r.problem!.detail).toMatch(/units/);
    expect(run(part([MAX_PART_MM, 100, 100]), { quantity: 1 }).problem).toBeNull();
  });

  it.each([0, -1, NaN, Infinity])("rejects a mass of %s", (mass) => {
    const r = run(part([100, 100, 100], mass));
    expect(r.design).toBeNull();
    expect(r.problem?.id).toBe("part-mass");
  });
});

describe("zero gaps and clearances", () => {
  it.each(parts.map((p) => p.id))("%s builds with no gaps, no zero-size boards, and says it is not restrained", (id) => {
    const p = parts.find((q) => q.id === id)!;
    for (const quantity of [1, 8, 200]) {
      const r = run(p, { quantity, partGapMm: 0, wallClearanceMm: 0, maxLayers: 3 });
      const d = r.design!;
      expectSound(d);
      // No gap anywhere means no dunnage (a padded tiny crate may still have some at the walls).
      if (d.layout.clearance.every((c) => c === 0)) {
        expect(d.members.some((m) => m.kind === "bearer" || m.kind === "blocking")).toBe(false);
      }
      expect(d.bom.every((l) => l.qty > 0 && l.cutMm.every((v) => v > 0) && l.stockMm.every((v) => v > 0))).toBe(true);
      expect(d.checks.find((c) => c.id === "blocking")?.level).toBe("caution");
    }
  });

  it("keeps bearers inside the walls under a narrow part with little clearance", () => {
    for (const wallClearanceMm of [0, 5, 20]) {
      expectSound(run(part([150, 150, 10]), { quantity: 3, wallClearanceMm }).design!);
    }
  });

  it("keeps blocking at the walls when only the part gap is zero", () => {
    const { design: d } = run(parts[0], { quantity: 4, partGapMm: 0, wallClearanceMm: 50 });
    expectSound(d!);
    expect(d!.members.some((m) => m.kind === "bearer")).toBe(true);
    expect(d!.members.some((m) => m.kind === "blocking")).toBe(true);
  });
});

describe("blocking check uses the gaps in the drawn crate", () => {
  const blocking = (d: CrateDesign) => d.checks.find((c) => c.id === "blocking")!;

  it("passes for a padded tiny part even with a 0 mm clearance setting", () => {
    const d = run(part([10, 10, 10]), { quantity: 1, wallClearanceMm: 0 }).design!;
    // Padded up to the minimum interior, so the real wall gaps are far over 19 mm.
    expect(Math.min(d.layout.clearance[0], d.layout.clearance[1])).toBeGreaterThan(19);
    expect(d.members.some((m) => m.kind === "blocking")).toBe(true);
    expect(blocking(d).level).toBe("ok");
  });

  it("names a 10 mm gap between parts as the problem", () => {
    const d = run(parts[0], { quantity: 4, partGapMm: 10 }).design!;
    expect(blocking(d).level).toBe("caution");
    expect(metric(blocking(d).detail)).toMatch(/10 mm gap between parts/);
  });

  it("names a thin wall clearance as the problem", () => {
    const d = run(parts[0], { quantity: 4, wallClearanceMm: 5 }).design!;
    expect(blocking(d).level).toBe("caution");
    expect(metric(blocking(d).detail)).toMatch(/5 mm clearance to the/);
  });

  it("ignores the part gap when there is one part per layer", () => {
    const d = run(parts[0], { quantity: 1, partGapMm: 0, wallClearanceMm: 50 }).design!;
    expect(d.layout.counts.slice(0, 2)).toEqual([1, 1]);
    expect(blocking(d).level).toBe("ok");
    expect(metric(blocking(d).detail)).toMatch(/smallest gap is 50 mm/);
  });
});

describe("settings at the boundary", () => {
  const base = DEFAULT_SETTINGS;

  it("clamps numbers into range and rounds counts", () => {
    expect(normalizeSettings({ quantity: 0 }, base).quantity).toBe(1);
    expect(normalizeSettings({ quantity: 5000 }, base).quantity).toBe(200);
    expect(normalizeSettings({ quantity: 3.6 }, base).quantity).toBe(4);
    expect(normalizeSettings({ maxLayers: 0 }, base).maxLayers).toBe(1);
    expect(normalizeSettings({ maxLayers: 9 }, base).maxLayers).toBe(6);
    expect(normalizeSettings({ partGapMm: -20 }, base).partGapMm).toBe(0);
    expect(normalizeSettings({ wallClearanceMm: 1e6 }, base).wallClearanceMm).toBe(300);
  });

  it("keeps the previous value for anything that is not a usable value", () => {
    const prev: CrateSettings = { ...base, quantity: 7, partGapMm: 25 };
    const bad = {
      quantity: NaN,
      partGapMm: Infinity,
      maxLayers: "3",
      keepUpright: "no",
      panelThickness: 13,
      wallClearanceMm: undefined,
    } as unknown as Partial<CrateSettings>;
    expect(normalizeSettings(bad, prev)).toEqual(prev);
  });

  it("applies valid changes and ignores unknown keys", () => {
    const patch = { keepUpright: false, panelThickness: 15, quantity: 12, colour: "red" } as Partial<CrateSettings>;
    const next = normalizeSettings(patch, base);
    expect(next).toEqual({ ...base, keepUpright: false, panelThickness: 15, quantity: 12 });
    expect(CrateSettingsSchema.safeParse(next).success).toBe(true);
  });

  it("reports what it clamped, rounded or rejected", () => {
    expect(settingsAdjustments({ quantity: 500 }, base)).toEqual([{ key: "quantity", kind: "clamped", value: 200, min: 1, max: 200 }]);
    expect(settingsAdjustments({ partGapMm: -20 }, base)).toEqual([{ key: "partGapMm", kind: "clamped", value: 0, min: 0, max: 300 }]);
    expect(settingsAdjustments({ quantity: 3.6 }, base)).toEqual([{ key: "quantity", kind: "rounded", value: 4, min: 1, max: 200 }]);
    expect(settingsAdjustments({ quantity: NaN }, { ...base, quantity: 7 })).toEqual([{ key: "quantity", kind: "rejected", value: 7, min: 1, max: 200 }]);
    expect(settingsAdjustments({ quantity: 12, partGapMm: 25 }, base)).toEqual([]);
    expect(settingsAdjustments({}, base)).toEqual([]);
  });

  it("always produces settings the schema accepts", () => {
    const junk = [NaN, -1, 0, 0.5, 1e9, -Infinity, "x", null, true, 19, "auto"];
    for (const v of junk) {
      for (const key of Object.keys(base) as (keyof CrateSettings)[]) {
        const next = normalizeSettings({ [key]: v } as Partial<CrateSettings>, base);
        expect(CrateSettingsSchema.safeParse(next).success).toBe(true);
      }
    }
  });

  it("explains settings that skipped the boundary instead of crashing", () => {
    const r = computeDesign(parts[0], { ...base, quantity: NaN });
    expect(r.design).toBeNull();
    expect(r.problem?.id).toBe("settings");
    const r2 = computeDesign(parts[0], { ...base, partGapMm: -1 });
    expect(r2.problem?.id).toBe("settings");
  });
});

describe("a layout or a reason", () => {
  it("always returns one or the other", () => {
    const sizes: Vec3[] = [[1, 1, 1], [5, 3000, 2], [1530, 172, 172], [0.01, 9000, 0.01], [20000, 20000, 20000]];
    for (const dims of sizes) {
      for (const quantity of [1, 7, 199, 200]) {
        for (const keepUpright of [true, false]) {
          for (const maxLayers of [1, 6]) {
            const r = run(part(dims), { quantity, keepUpright, maxLayers, partGapMm: 0, wallClearanceMm: 300 });
            expect(r.design === null).toBe(r.problem !== null);
            // Every valid input has at least one layout (see spec §7.2).
            expect(r.layouts.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
