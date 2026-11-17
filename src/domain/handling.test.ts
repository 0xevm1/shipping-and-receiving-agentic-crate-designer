import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import type { Check, Member } from "./crate";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import {
  analyseHandling,
  centreOfGravity,
  forkOpenings,
  handlingChecks,
  memberMasses,
  offsetText,
  partMasses,
  placeTines,
  type Handling,
} from "./handling";
import type { CrateSettings, Vec3 } from "./schema";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards, type DeepPartial, type ShopStandards } from "./standards";

const custom = (patch: DeepPartial<ShopStandards>): ShopStandards => {
  const r = parseStandards(mergeStandards(DEFAULT_STANDARDS, patch));
  if (!r.ok) throw new Error(r.error);
  return r.standards;
};
const design = (partId: string, patch: Partial<CrateSettings> = {}, standards = DEFAULT_STANDARDS) =>
  computeDesign(getPart(partId), { ...DEFAULT_SETTINGS, ...patch }, null, standards).design!;
const check = (checks: Check[], id: string) => checks.find((c) => c.id === id)!;

const board = (kind: Member["kind"], min: Vec3, size: Vec3): Member => ({
  kind,
  material: "lumber",
  assembly: "base",
  face: "base",
  label: kind,
  bomKey: "",
  min,
  size,
});

describe("centre of gravity", () => {
  it("is the mass-weighted mean of the points", () => {
    expect(centreOfGravity([{ at: [0, 0, 0], kg: 1 }, { at: [100, 0, 0], kg: 3 }])).toEqual([75, 0, 0]);
    expect(centreOfGravity([])).toEqual([0, 0, 0]);
  });

  it("weighs boards by volume × the standard density, at their centres", () => {
    const m = board("skid", [0, 0, -100], [1000, 100, 100]);
    expect(memberMasses([m])).toEqual([{ at: [500, 50, -50], kg: 0.01 * 480 }]);
    expect(memberMasses([{ ...m, material: "plywood" }])[0].kg).toBeCloseTo(6);
  });

  it("puts each part at its bounding-box centre", () => {
    const layout = { cellSize: [100, 200, 300] as Vec3, slots: [{ index: [0, 0, 0] as [number, number, number], min: [50, 50, 50] as Vec3 }] };
    expect(partMasses(layout, 7)).toEqual([{ at: [100, 150, 200], kg: 7 }]);
  });

  it("lies on both centre lines of a symmetric crate", () => {
    for (const [id, q] of [["PART-001", 4], ["PART-003", 8], ["PART-002", 2]] as const) {
      const d = design(id, { quantity: q });
      const [L, W] = d.layout.interior;
      expect(d.centerOfGravityMm[0]).toBeCloseTo(L / 2, 6);
      expect(d.centerOfGravityMm[1]).toBeCloseTo(W / 2, 6);
      expect(d.handling.offsetMm[0]).toBeCloseTo(0, 6);
      expect(d.handling.offsetMm[1]).toBeCloseTo(0, 6);
      expect(d.centerOfGravityMm).toBe(d.handling.cogMm);
    }
  });

  it("combines the crate and the parts: between the empty crate's and the payload's", () => {
    const d = design("PART-001", { quantity: 4 });
    const crate = centreOfGravity(memberMasses(d.members))[2];
    const payload = centreOfGravity(partMasses(d.layout, 21.5))[2];
    expect(d.centerOfGravityMm[2]).toBeGreaterThan(Math.min(crate, payload));
    expect(d.centerOfGravityMm[2]).toBeLessThan(Math.max(crate, payload));
    // Total moment check: the weighted mean of the two groups.
    const z = (crate * d.tareKg + payload * d.payloadKg) / d.grossKg;
    expect(d.centerOfGravityMm[2]).toBeCloseTo(z, 6);
  });

  it("moves toward an offset load: the same crate with its last part (+X, +Y) left out", () => {
    const d = design("PART-001", { quantity: 4 });
    const three = analyseHandling(d.members, { ...d.layout, slots: d.layout.slots.slice(0, 3) }, 21.5);
    // Toward the left end and the front, by the missing part's moment over the new total.
    expect(three.offsetMm[0]).toBeLessThan(-1);
    expect(three.offsetMm[1]).toBeLessThan(-1);
    const gap = d.layout.slots[1].min[0] - d.layout.slots[0].min[0];
    const moment = 21.5 * (gap / 2);
    expect(three.offsetMm[0]).toBeCloseTo(-moment / (d.grossKg - 21.5), 6);
  });

  it("is reported in the crate-interior frame, above the ground by the skids and floor", () => {
    const d = design("PART-001", { quantity: 4 });
    const { floorMm, skid } = d.construction;
    expect(d.handling.groundZ).toBe(-floorMm - skid.tall);
    expect(d.handling.heightMm).toBeCloseTo(d.centerOfGravityMm[2] + floorMm + skid.tall, 6);
  });
});

describe("fork openings", () => {
  it("are read from the skid members, whatever their count and spacing", () => {
    const floor = board("floor", [0, 0, -19], [1000, 1000, 19]);
    const skids = [0, 450, 900].map((y) => board("skid", [0, y, -119], [1000, 100, 100]));
    expect(forkOpenings([floor, ...skids])).toEqual([
      { y: 100, width: 350, clearMm: 100 },
      { y: 550, width: 350, clearMm: 100 },
    ]);
    // Something hung under the floor over an opening lowers its clearance.
    const joist = board("bearer", [0, 600, -60], [1000, 50, 41]);
    expect(forkOpenings([floor, joist, ...skids]).map((o) => o.clearMm)).toEqual([100, 59]);
  });

  it("follow the design: one opening between two skids, the skid height clear", () => {
    const d = design("PART-001", { quantity: 4 });
    expect(d.handling.openings).toHaveLength(d.construction.skidCount - 1);
    expect(d.handling.openings[0].clearMm).toBe(d.construction.skid.tall);
    expect(d.handling.openings[0].width).toBeCloseTo(d.layout.external[1] - 2 * d.construction.skid.wide, 6);
  });
});

describe("placing tines", () => {
  const fork = { minClearMm: 75, tineWidthMm: 100, spreadMm: { min: 250, max: 1100 } };
  const open = (y: number, width: number) => ({ y, width, clearMm: 89 });

  it("puts both tines in one wide opening, either side of the CoG", () => {
    const t = placeTines([open(100, 474)], 337, fork)!;
    expect(t[0]).toBeLessThanOrEqual(337);
    expect(t[1]).toBeGreaterThanOrEqual(337);
    expect(t[1] - t[0] + 100).toBeCloseTo(250, 6);
  });

  it("refuses an opening narrower than the smallest spread", () => {
    expect(placeTines([open(0, 204)], 102, fork)).toBeNull();
  });

  it("uses one opening per tine across a middle skid", () => {
    const jack = { minClearMm: 85, tineWidthMm: 180, spreadMm: { min: 520, max: 690 } };
    const t = placeTines([open(89, 408), open(586, 408)], 541, jack)!;
    expect(t[0]).toBeLessThan(497);
    expect(t[1]).toBeGreaterThan(586);
  });

  it("refuses when the CoG can't be between the tines", () => {
    // Both openings on one side of the CoG.
    expect(placeTines([open(0, 300), open(400, 300)], 900, fork)).toBeNull();
  });
});

describe("handling checks", () => {
  const base = (patch: Partial<Handling> = {}): Handling => ({
    ...design("PART-001", { quantity: 4 }).handling,
    ...patch,
  });

  it("pass for the default crate, with the pallet jack as info (forklift only)", () => {
    const checks = design("PART-001", { quantity: 4 }).checks;
    expect(check(checks, "cog-offset")).toMatchObject({ level: "ok", title: "Centre of gravity near the middle" });
    expect(check(checks, "cog-offset").detail).toContain("on both centre lines");
    expect(check(checks, "cog-tip").level).toBe("ok");
    expect(check(checks, "forklift")).toMatchObject({ level: "ok", title: "Forklift fits from the ends" });
    expect(check(checks, "forklift").detail).toBe(
      "Forklift: fits from the ends, 89 mm clear under the floor, needs 75 mm. Room between the skids for 100 mm tines at a 250 mm–1,100 mm spread, either side of the centre of gravity.",
    );
    expect(check(checks, "pallet-jack")).toMatchObject({ level: "info", title: "Forklift only: too narrow for a pallet jack" });
    expect(check(checks, "pallet-jack").detail).toContain("the widest opening between the skids is 474 mm");
  });

  it("come in a fixed order after the base rating", () => {
    const ids = design("PART-001", { quantity: 4 }).checks.map((c) => c.id);
    const at = ids.indexOf("base-rating");
    expect(ids.slice(at + 1, at + 5)).toEqual(["cog-offset", "cog-tip", "forklift", "pallet-jack"]);
  });

  it("warn when the CoG is more than the standard share of the footprint off-centre, and say where", () => {
    const h = base();
    const [L] = h.footprintMm;
    const just = 0.1 * L;
    expect(check(handlingChecks({ ...h, offsetMm: [-(just - 1), 0] }), "cog-offset").level).toBe("ok");
    const off = check(handlingChecks({ ...h, offsetMm: [-120, 0] }), "cog-offset");
    expect(off.level).toBe("caution");
    expect(off.detail).toMatch(/^Centre of gravity is 120 mm toward the left end; mark it on the crate\./);
    expect(check(handlingChecks({ ...h, offsetMm: [0, 70] }), "cog-offset").detail).toContain("70 mm toward the back");
    // A looser standard lets it pass.
    expect(check(handlingChecks({ ...h, offsetMm: [-120, 0] }, custom({ handling: { cogOffsetRatio: 0.2 } })), "cog-offset").level).toBe("ok");
  });

  it("warn under the standard tip angle", () => {
    const h = base();
    expect(check(handlingChecks({ ...h, tipAngleDeg: 30.1 }), "cog-tip").level).toBe("ok");
    const tip = check(handlingChecks({ ...h, tipAngleDeg: 24, tipToward: "side" }), "cog-tip");
    expect(tip).toMatchObject({ level: "caution", title: "Top-heavy" });
    expect(tip.detail).toContain("tips over a side at 24°, under the 30° limit");
  });

  it("measure the tip angle to the nearest base edge", () => {
    const d = design("PART-001", { quantity: 4 });
    const h = d.handling;
    const halfW = d.layout.external[1] / 2;
    expect(h.tipToward).toBe("side");
    expect(h.tipAngleDeg).toBeCloseTo((Math.atan2(halfW, h.heightMm) * 180) / Math.PI, 6);
  });

  it("caution per device when the opening is too low: taller standard needs than the skids give", () => {
    const s = custom({ handling: { palletJack: { minClearMm: 90 }, forklift: { minClearMm: 95 } } });
    const d = design("PART-003", { quantity: 8 }, s);
    expect(check(d.checks, "pallet-jack")).toMatchObject({ level: "caution", title: "Pallet jack may not fit" });
    expect(check(d.checks, "pallet-jack").detail).toBe("Pallet jack: enters from the ends, 89 mm clear under the floor, needs 90 mm. Use taller skids.");
    expect(check(d.checks, "forklift").level).toBe("caution");
  });

  it("pass both devices when there is a middle skid between two openings", () => {
    const d = design("PART-003", { quantity: 8 });
    expect(d.construction.skidCount).toBe(3);
    expect(check(d.checks, "pallet-jack")).toMatchObject({ level: "ok", title: "Pallet jack fits from the ends" });
    expect(check(d.checks, "forklift").level).toBe("ok");
  });

  it("caution for both when the crate is too narrow for any forks", () => {
    const d = design("PART-002", { quantity: 1 });
    expect(check(d.checks, "forklift")).toMatchObject({ level: "caution", title: "Forklift may not fit" });
    expect(check(d.checks, "pallet-jack").level).toBe("caution");
  });

  it("follow the skids the construction builds (heavy skids are taller)", () => {
    const s = custom({ construction: { heavySkidOverKg: 0 }, handling: { palletJack: { minClearMm: 120 } } });
    const d = design("PART-003", { quantity: 8 }, s);
    expect(d.handling.openings[0].clearMm).toBe(140);
    expect(check(d.checks, "pallet-jack").level).toBe("ok");
  });
});

describe("offsetText", () => {
  it("names the end and side, or nothing when centred", () => {
    expect(offsetText([-120, 0])).toBe("120 mm toward the left end");
    expect(offsetText([1300, -40])).toBe("1,300 mm toward the right end and 40 mm toward the front");
    expect(offsetText([0.2, -0.4])).toBeNull();
  });
});

describe("handling standards", () => {
  it("default to the documented equipment sizes and thresholds", () => {
    expect(DEFAULT_STANDARDS.handling).toEqual({
      forklift: { minClearMm: 75, tineWidthMm: 100, spreadMm: { min: 250, max: 1100 } },
      palletJack: { minClearMm: 85, tineWidthMm: 180, spreadMm: { min: 520, max: 690 } },
      cogOffsetRatio: 0.1,
      minTipAngleDeg: 30,
    });
  });

  it("reject a spread range upside down or narrower than two tines", () => {
    expect(parseStandards(mergeStandards(DEFAULT_STANDARDS, { handling: { forklift: { spreadMm: { min: 900, max: 800 } } } })).ok).toBe(false);
    const narrow = parseStandards(mergeStandards(DEFAULT_STANDARDS, { handling: { palletJack: { spreadMm: { min: 300 } } } }));
    expect(narrow).toEqual({ ok: false, error: "handling.palletJack.spreadMm: The spread can't be less than two tines wide" });
  });

  it("analyse an arbitrary member list without a design", () => {
    const floor = board("floor", [0, 0, -19], [1000, 800, 19]);
    const skids = [0, 700].map((y) => board("skid", [0, y, -119], [1000, 100, 100]));
    const h = analyseHandling([floor, ...skids], { slots: [], cellSize: [1, 1, 1] }, 0);
    expect(h.openings).toEqual([{ y: 100, width: 600, clearMm: 100 }]);
    expect(h.devices.map((d) => d.fits)).toEqual([true, true]);
  });
});
