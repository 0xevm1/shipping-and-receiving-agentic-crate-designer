import { describe, expect, it } from "vitest";
import { getPart, parts } from "./catalog";
import { screwSchedule } from "./crate";
import { computeDesign, DEFAULT_SETTINGS, type DesignPart } from "./design";
import type { CrateSettings } from "./schema";
import { crateGrossLimitKg, planShipment } from "./shipment";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards, type DeepPartial, type ShopStandards } from "./standards";
import {
  floorCheck,
  frameCount,
  G,
  joistChecks,
  maxSkidCount,
  minSkidCount,
  pitch,
  sizeBase,
  sizeLid,
  skidChecks,
  skidShare,
  type BaseInput,
} from "./structure";

const custom = (patch: DeepPartial<ShopStandards>): ShopStandards => {
  const r = parseStandards(mergeStandards(DEFAULT_STANDARDS, patch));
  if (!r.ok) throw new Error(r.error);
  return r.standards;
};
const design = (part: DesignPart, patch: Partial<CrateSettings> = {}, standards = DEFAULT_STANDARDS) =>
  computeDesign(part, { ...DEFAULT_SETTINGS, ...patch }, null, standards).design!;

const STD = { wide: 89, tall: 89 };
const HEAVY = { wide: 89, tall: 140 };
/** The worked example in spec §7.15. */
const EXAMPLE: BaseInput = {
  extL: 1200,
  extW: 1000,
  floorAreaMm2: 1100 * 900,
  payloadKg: 800,
  dead: { allKg: 150, contentsKg: 40 },
  floorMm: 19,
  skids: [STD, HEAVY],
};
const capacity = (checks: { payloadKg: number }[]) => Math.min(...checks.map((c) => c.payloadKg));

describe("the formulas (spec §7.15)", () => {
  it("rates a skid in bending, shear and bearing", () => {
    // 4×6 on edge, S = 89 × 140² / 6; 3 skids, so an inner skid carries half; span 1200.
    const [bending, shear, bearing] = skidChecks(HEAVY, 3, 1200, 0);
    const S = (89 * 140 * 140) / 6;
    expect(bending.capacityKg).toBeCloseTo((8 * 7.8 * S) / (1200 * 0.5) / (G * 1.5), 6);
    expect(bending.capacityKg).toBeCloseTo(2054.8, 1);
    expect(shear.capacityKg).toBeCloseTo((2 * 0.93 * 89 * 140) / (1.5 * 0.5) / (G * 1.5), 6);
    expect(bearing.capacityKg).toBeCloseTo((2 * 2.93 * 89 * 100) / 0.5 / (G * 1.5), 6);
  });

  it("shares the load: half each on two skids, 1 / (n − 1) on an inner skid", () => {
    expect(skidShare(2)).toBe(0.5);
    expect(skidShare(3)).toBe(0.5);
    expect(skidShare(5)).toBe(0.25);
  });

  it("rates the floor as a simple span, falling with the span squared", () => {
    const a = floorCheck(19, 400, 1e6, 0);
    expect(a.capacityKg).toBeCloseTo((8 * 6 * ((19 * 19) / 6) * 1e6) / (400 * 400) / (G * 1.5), 6);
    expect(floorCheck(19, 800, 1e6, 0).capacityKg).toBeCloseTo(a.capacityKg / 4, 6);
    // The dead weight on the member comes off the payload it allows.
    expect(floorCheck(19, 400, 1e6, 40).payloadKg).toBeCloseTo(a.capacityKg - 40, 6);
  });

  it("rates joists in bending, shear and bearing on the skids", () => {
    const [bending, shear, bearing] = joistChecks({ wide: 38, tall: 89 }, 400, 450, 89, 1e6, 0);
    expect(bending.capacityKg).toBeCloseTo((8 * 7.8 * ((38 * 89 * 89) / 6) * 1e6) / (400 * 450 * 450) / (G * 1.5), 6);
    expect(shear.capacityKg).toBeCloseTo((2 * 0.93 * 38 * 89 * 1e6) / (1.5 * 400 * 450) / (G * 1.5), 6);
    expect(bearing.capacityKg).toBeCloseTo((2.93 * 38 * 89 * 1e6) / (400 * 450) / (G * 1.5), 6);
  });

  it("works through the spec's example", () => {
    const p = sizeBase(EXAMPLE);
    // 4×4 skids allow 830 − 150 = 680 kg < 800, so 4×6 at the same 3 skids.
    const std = capacity(skidChecks(STD, 3, 1200, 150));
    expect(std).toBeCloseTo(680, 0);
    expect(p).toMatchObject({ skid: HEAVY, skidCount: 3, joist: { wide: 38, tall: 89 }, joistCount: 4, joistReason: "payload", ok: true });
    expect(p.skidOpeningMm).toBeCloseTo(366.5, 6);
    expect(p.floorSpanMm).toBeCloseTo(387.33, 2);
    expect(p.governing.id).toBe("floor-bending");
    expect(p.governing.payloadKg).toBeCloseTo(1255.1, 1);
  });
});

describe("skid count and section", () => {
  const base = (payloadKg: number, patch: Partial<BaseInput> = {}) => sizeBase({ ...EXAMPLE, dead: { allKg: 0, contentsKg: 0 }, payloadKg, ...patch });
  /** The payload 4×4 skids allow at the spacing-rule count. */
  const stdLimit = capacity(skidChecks(STD, 3, 1200, 0));

  it("starts from the spacing rule's count and the standard section", () => {
    expect(minSkidCount(1000)).toBe(3);
    expect(base(100)).toMatchObject({ skid: STD, skidCount: 3, ok: true });
  });

  it("keeps the standard section exactly at its limit, and goes heavy just over it", () => {
    expect(base(stdLimit - 1e-6).skid).toEqual(STD);
    expect(base(stdLimit + 0.01).skid).toEqual(HEAVY);
    expect(base(stdLimit + 0.01).skidCount).toBe(3);
  });

  it("adds a skid when no section passes, and never closes the fork opening", () => {
    const heavyLimit = capacity(skidChecks(HEAVY, 3, 1200, 0));
    const p = base(heavyLimit + 1);
    expect(p.skidCount).toBe(4);
    // The smallest section that passes at 4 skids, where an inner skid carries a third.
    const atFour = capacity(skidChecks(STD, 4, 1200, 0)) >= heavyLimit + 1 ? STD : HEAVY;
    expect(p.skid).toEqual(atFour);
    expect(p.skidOpeningMm).toBeGreaterThanOrEqual(DEFAULT_STANDARDS.structure.minForkOpeningMm);
    expect(maxSkidCount(1000, 89, 200)).toBe(4); // (1000 + 200) / (89 + 200)
  });

  it("reports a problem when even the most skids of the heaviest section fail", () => {
    const p = base(50000);
    expect(p.ok).toBe(false);
    expect(p.skidCount).toBe(maxSkidCount(1000, 89, 200));
    expect(p.skid).toEqual(HEAVY);
    expect(p.governing.payloadKg).toBeLessThan(50000);
  });

  it("only offers the heavy section above the heavy-skid payload", () => {
    const heavy = design({ id: "x", name: "Block", mass_kg: 720, dimensions_mm: [400, 400, 300] }, { quantity: 1 });
    expect(heavy.construction.skid).toEqual(HEAVY);
  });
});

describe("floor joists", () => {
  const base = (payloadKg: number, patch: Partial<BaseInput> = {}) => sizeBase({ ...EXAMPLE, dead: { allKg: 0, contentsKg: 0 }, payloadKg, ...patch });

  it("adds joists above the payload threshold, not at it", () => {
    const at = DEFAULT_STANDARDS.structure.joistOverKg;
    expect(base(at).joist).toBeNull();
    expect(base(at + 0.01)).toMatchObject({ joistReason: "payload", joistCount: 4 });
  });

  it("adds joists when the floor fails over the skids, below the threshold", () => {
    // Two skids about 1,400 mm apart (a wide skid spacing): the floor can't span it.
    const standards = custom({ construction: { skidSpacingMm: 5000 } });
    const input = { ...EXAMPLE, extW: 1500, floorAreaMm2: 1100 * 1400, payloadKg: 300, dead: { allKg: 0, contentsKg: 0 }, standards };
    const p = sizeBase(input);
    expect(p.skidCount).toBe(2);
    expect(floorCheck(19, pitch(1500, 89, 2), 1100 * 1400, 0).payloadKg).toBeLessThan(300);
    expect(p.joistReason).toBe("floor-span");
    expect(p.ok).toBe(true);
  });

  it("closes the joists up until the floor and joists pass", () => {
    const p = base(1500, { extW: 700, floorAreaMm2: 1100 * 600 });
    expect(p.ok).toBe(true);
    expect(p.joistCount).toBeGreaterThan(4);
    expect(p.floorSpanMm).toBeLessThan(DEFAULT_STANDARDS.structure.maxJoistSpacingMm);
    for (const c of p.checks) expect(c.payloadKg).toBeGreaterThanOrEqual(1500);
    // One joist fewer would fail.
    const fewer = pitch(1200, 38, p.joistCount - 1);
    const looser = [floorCheck(19, fewer, 1100 * 600, 0), ...joistChecks({ wide: 38, tall: 89 }, fewer, pitch(700, p.skid.wide, p.skidCount), p.skid.wide, 1100 * 600, 0)];
    expect(capacity(looser)).toBeLessThan(1500);
  });
});

describe("lid", () => {
  it("is the nominal frame when crates aren't stacked", () => {
    const lid = sizeLid({ lidL: 1000, lidW: 800, panelMm: 12, nominalCount: frameCount(1000) });
    expect(lid).toMatchObject({ member: { wide: 89, tall: 19 }, count: 3, joists: false, capacityKg: null, ok: true });
  });

  it("is sized for a stacking load: closer cleats, then joists on edge", () => {
    const s = custom({ structure: { lidStackKg: 50 } });
    const light = sizeLid({ lidL: 1000, lidW: 800, panelMm: 12, nominalCount: 3, standards: s });
    expect(light.ok).toBe(true);
    expect(light.capacityKg).toBeGreaterThanOrEqual(50);
    const heavy = sizeLid({ lidL: 1000, lidW: 800, panelMm: 12, nominalCount: 3, standards: custom({ structure: { lidStackKg: 500 } }) });
    expect(heavy).toMatchObject({ joists: true, member: { wide: 38, tall: 89 }, ok: true });
  });

  it("adds a lid check and builds the lid joists in the design", () => {
    const d = design(getPart("PART-001"), { quantity: 8 }, custom({ structure: { lidStackKg: 500 } }));
    const lid = d.checks.find((c) => c.id === "lid")!;
    expect(lid.level).toBe("ok");
    expect(lid.detail).toMatch(/^Sized for 500 kg stacked on top; rated [\d,]+ kg, with \d+ 2×4 joists on edge\.$/);
    expect(d.bom.some((l) => l.label === "Lid joist" && l.stock === "38 × 89")).toBe(true);
    // The lid is taller, and the crate with it.
    const nominal = design(getPart("PART-001"), { quantity: 8 });
    expect(d.layout.external[2]).toBe(nominal.layout.external[2] + 89 - 19);
    expect(nominal.checks.some((c) => c.id === "lid")).toBe(false);
  });

  it("cautions when the lid can't take the stacking load", () => {
    const d = design(getPart("PART-001"), { quantity: 8 }, custom({ structure: { lidStackKg: 100000 } }));
    expect(d.checks.find((c) => c.id === "lid")).toMatchObject({ level: "caution", title: "Lid can't take the stacking load" });
  });
});

describe("designCrate with structural sizing", () => {
  // 30 brackets: 645 kg of payload, one crate under the 1,000 kg limit.
  const heavy = design(getPart("PART-001"), { quantity: 30 });

  it("builds joists between the skids and the floor", () => {
    const c = heavy.construction;
    expect(c).toMatchObject({ skid: HEAVY, skidCount: 3, joist: { wide: 38, tall: 89, count: 7 }, baseMm: 140 + 89 + 19 });
    const joists = heavy.members.filter((m) => m.kind === "joist");
    expect(joists).toHaveLength(7);
    for (const j of joists) {
      expect(j).toMatchObject({ assembly: "base", face: "base", label: "Floor joist", material: "lumber" });
      expect(j.min[2]).toBe(-19 - 89);
      expect(j.size[1]).toBe(heavy.layout.external[1]);
    }
    expect(heavy.bom.find((l) => l.kind === "joist")).toMatchObject({ label: "Floor joist", stock: "38 × 89", qty: 7 });
    const skids = heavy.members.filter((m) => m.kind === "skid");
    for (const s of skids) expect(s.min[2]).toBe(-248);
  });

  it("keeps the bounding box equal to the outside size", () => {
    for (let a = 0; a < 3; a++) {
      const lo = Math.min(...heavy.members.map((m) => m.min[a]));
      const hi = Math.max(...heavy.members.map((m) => m.min[a] + m.size[a]));
      expect(hi - lo).toBeCloseTo(heavy.layout.external[a], 6);
    }
  });

  it("screws the joists to the skids and the floor to the joists", () => {
    const lines = screwSchedule(heavy.members, heavy.layout.interior);
    expect(lines.find((l) => l.id === "skids")).toMatchObject({ title: "Floor joists to skids", qty: 7 * 3 * 2 });
    expect(lines.find((l) => l.id === "joists")).toMatchObject({ title: "Floor to joists", qty: 7 * (Math.ceil(heavy.layout.external[1] / 300) + 1) });
    expect(heavy.screws).toBe(lines.reduce((n, l) => n + l.qty, 0));
  });

  it("reports the computed rating in the base-rating check", () => {
    const check = heavy.checks.find((c) => c.id === "base-rating")!;
    const rated = Math.floor(heavy.structure.ratedPayloadKg);
    expect(check.level).toBe("ok");
    expect(check.title).toBe("Within the base rating");
    expect(check.detail).toBe(
      `Base rated ${rated} kg; this crate's payload is 645 kg (${Math.round((645 / heavy.structure.ratedPayloadKg) * 100)}%). ` +
        "3 × 4×6 skids, 7 2×4 floor joists and a 19 mm floor, sized for 1.5× the load (skid bending governs).",
    );
    expect(rated).toBe(859);
  });

  it("over-estimates the crate's own weight, so the rating is on the safe side", () => {
    for (const p of parts) {
      for (const quantity of [...p.suggested_quantities, 30]) {
        for (const keepUpright of [true, false]) {
          const d = design(p, { quantity, keepUpright });
          const onSkids = d.members
            .filter((m) => m.kind !== "skid")
            .reduce((kg, m) => kg + ((m.size[0] * m.size[1] * m.size[2]) / 1e9) * DEFAULT_STANDARDS.rates.densityKgM3[m.material], 0);
          expect(d.structure.dead.allKg).toBeGreaterThanOrEqual(onSkids);
          expect(d.structure.dead.contentsKg).toBeGreaterThanOrEqual(d.tareKgByAssembly.inside);
        }
      }
    }
  });

  it("leaves every sample part at its suggested quantities on the nominal base", () => {
    for (const p of parts) {
      for (const quantity of p.suggested_quantities) {
        const d = design(p, { quantity });
        expect(d.construction.joist).toBeNull();
        expect(d.construction.skid).toEqual(STD);
        expect(d.construction.skidCount).toBe(minSkidCount(d.layout.external[1]));
        expect(d.checks.find((c) => c.id === "base-rating")!.level).toBe("ok");
      }
    }
  });
});

describe("shipment planning on the computed rating (#25 with #7)", () => {
  const settings = (patch: Partial<CrateSettings>) => ({ ...DEFAULT_SETTINGS, ...patch });

  it("limits a crate to the smaller of the per-crate gross and the base rating", () => {
    const d = design(getPart("PART-001"), { quantity: 30 });
    expect(crateGrossLimitKg(d)).toBe(Math.min(1000, d.structure.ratedPayloadKg + d.tareKg));
    const roomy = custom({ limits: { perCrate: { maxGrossKg: 100000 } } });
    expect(crateGrossLimitKg(d, roomy)).toBeCloseTo(d.structure.ratedPayloadKg + d.tareKg, 6);
  });

  it("splits on the computed rating when the gross limit is out of the way", () => {
    // Weaker lumber and no gross limit: the base rating decides the split.
    const s = custom({ limits: { perCrate: { maxGrossKg: 100000 } }, structure: { lumberBendingMPa: 3 } });
    const t = performance.now();
    const plan = planShipment(getPart("PART-001"), settings({ quantity: 200 }), null, s);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(plan.split).toBe(true);
    expect(plan.crates.reduce((n, c) => n + c.count * c.quantity, 0)).toBe(200);
    for (const c of plan.crates) {
      const d = c.result.design!;
      expect(d.payloadKg).toBeLessThanOrEqual(d.structure.ratedPayloadKg + 1e-9);
      expect(d.checks.find((x) => x.id === "base-rating")!.level).toBe("ok");
      expect(d.checks.find((x) => x.id === "crate-limit")!.detail).toMatch(/or the base rating/);
    }
    // Stronger lumber rates the base higher: fewer crates.
    const strong = planShipment(getPart("PART-001"), settings({ quantity: 200 }), null, custom({ limits: { perCrate: { maxGrossKg: 100000 } } }));
    expect(strong.totals.crates).toBeLessThan(plan.totals.crates);
  });

  it("keeps the sample splits at the default standards", () => {
    const plan = planShipment(getPart("PART-001"), settings({ quantity: 200 }));
    expect(plan.crates.map((c) => [c.count, c.quantity])).toEqual([
      [6, 30],
      [1, 20],
    ]);
  });
});
