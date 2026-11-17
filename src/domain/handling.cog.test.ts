import { describe, expect, it } from "vitest";
import type { PartCog } from "./cog";
import { designCrate } from "./crate";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { partMasses } from "./handling";
import { ORIENTATIONS, rotatedOffset } from "./orientations";
import type { DesignPart, Vec3 } from "./schema";
import { DEFAULT_STANDARDS } from "./standards";
import { metricText } from "./testFixtures";

/** A 1000 × 300 × 300 mm part of 400 kg: heavy enough that its own centre decides where the crate balances. */
const SHAFT: DesignPart = { id: "SHAFT", name: "Shaft", mass_kg: 400, dimensions_mm: [1000, 300, 300] };
const withCog = (cog?: PartCog): DesignPart => (cog ? { ...SHAFT, cog } : SHAFT);
const one = (part: DesignPart) => computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 1 }, null).design!;
const offsetCheck = (d: ReturnType<typeof one>) => d.checks.find((c) => c.id === "cog-offset")!;

describe("a part's own centre of gravity in the crate", () => {
  it("moves the crate's centre of gravity and trips the off-centre check where a centred part does not", () => {
    const centred = one(withCog());
    const lopsided = one(withCog({ offsetMm: [300, 0, 0], source: "supplied" })); // 30% of the length toward +X
    expect(offsetCheck(centred).level).toBe("ok");
    expect(offsetCheck(lopsided).level).toBe("caution");
    expect(lopsided.handling.cogMm[0]).toBeGreaterThan(centred.handling.cogMm[0] + 100);
    expect(lopsided.handling.offsetMm[0]).toBeGreaterThan(centred.handling.offsetMm[0] + 100);
  });

  it("carries the offset through the orientation: turned 90 degrees it moves to the other axis", () => {
    const part = withCog({ offsetMm: [300, 0, 0], source: "supplied" });
    const layout = computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 1 }, null).design!.layout;
    const turned = ORIENTATIONS.find((o) => o.id === "turned")!;
    const slot = { ...layout, orientation: turned, cellSize: [300, 1000, 300] as Vec3 };
    const [p] = partMasses(slot, 1, part.cog);
    const [q] = partMasses({ ...slot, orientation: ORIENTATIONS[0] }, 1, part.cog);
    // Same box centre, but the weight is now 300 mm along +Y instead of +X.
    expect(p.at[1] - q.at[1]).toBeCloseTo(300);
    expect(p.at[0] - q.at[0]).toBeCloseTo(-300);
  });

  it("turning the part 180 degrees in the layout moves the crate's centre of gravity to the other side", () => {
    const part = withCog({ offsetMm: [300, 0, 0], source: "supplied" });
    const d = one(part);
    const half = { ...ORIENTATIONS[0], id: "half-turn", label: "Turned 180°", euler: [0, 0, Math.PI] as [number, number, number] };
    const flipped = designCrate(part, { ...DEFAULT_SETTINGS, quantity: 1 }, { ...d.layout, orientation: half });
    expect(d.handling.offsetMm[0]).toBeGreaterThan(0);
    expect(flipped.handling.offsetMm[0]).toBeCloseTo(-d.handling.offsetMm[0], 6);
    expect(flipped.handling.offsetMm[1]).toBeCloseTo(d.handling.offsetMm[1], 6);
    // The crate is the same; only the weight moved.
    expect(flipped.grossKg).toBe(d.grossKg);
  });

  it("rotates an offset by the orientation's matrix", () => {
    expect(rotatedOffset([300, 0, 0], ORIENTATIONS[0])).toEqual([300, 0, 0]);
    expect(rotatedOffset([300, 0, 0], { euler: [0, 0, Math.PI / 2] })).toEqual([0, 300, 0]);
    expect(rotatedOffset([300, 0, 0], { euler: [0, 0, Math.PI] })).toEqual([-300, 0, 0]);
    // On its side (a quarter about X): the part's +Z turns to -Y, +Y to +Z.
    expect(rotatedOffset([0, 0, 100], { euler: [Math.PI / 2, 0, 0] })).toEqual([0, -100, 0]);
    expect(rotatedOffset([0, 100, 0], { euler: [Math.PI / 2, 0, 0] })).toEqual([0, 0, 100]);
  });

  it("raises the centre of gravity when the part's weight sits high", () => {
    const low = one(withCog({ offsetMm: [0, 0, -100], source: "estimated" }));
    const high = one(withCog({ offsetMm: [0, 0, 100], source: "estimated" }));
    expect(high.handling.heightMm).toBeGreaterThan(low.handling.heightMm + 100);
  });

  it("says which source the check used", () => {
    const say = (cog?: PartCog) => metricText(offsetCheck(one(withCog(cog))).detail);
    expect(say({ offsetMm: [0, 0, 0], source: "supplied" })).toContain("the one supplied");
    expect(say({ offsetMm: [0, 0, 0], source: "estimated" })).toContain("estimated from the model's mesh");
    expect(say()).toContain("assumed at the middle of its bounding box");
    expect(one(withCog()).handling.cogBasis).toBe("assumed");
    expect(one(withCog({ offsetMm: [10, 0, 0], source: "estimated" })).handling.cogBasis).toBe("estimated");
  });

  it("leaves a part without a centre exactly where the box centre put it", () => {
    const a = one(withCog());
    const b = one(withCog({ offsetMm: [0, 0, 0], source: "supplied" }));
    expect(b.handling.cogMm).toEqual(a.handling.cogMm);
    expect(DEFAULT_STANDARDS.handling.cogOffsetRatio).toBeGreaterThan(0);
  });
});
