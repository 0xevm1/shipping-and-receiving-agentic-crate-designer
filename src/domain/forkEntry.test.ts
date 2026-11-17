import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import type { Check, CrateDesign, Member } from "./crate";
import { entryDirections, FORK_ENTRIES, liftHeightMm, skidsRunAcross, type ForkEntry } from "./forkEntry";
import { analyseHandling, forkOpenings, handlingChecks } from "./handling";
import { memberBounds } from "./members";
import { DEFAULT_STANDARDS, parseStandards, standardsFromJson, standardsToJson } from "./standards";
import { custom, designOf, metricText as metric } from "./testFixtures";

const withEntry = (forkEntry: ForkEntry) => custom({ handling: { forkEntry } });
const build = (partId: string, quantity: number, forkEntry: ForkEntry) => designOf(getPart(partId), { quantity }, withEntry(forkEntry));
const check = (checks: Check[], id: string) => checks.find((c) => c.id === id)!;
const kinds = (d: CrateDesign, kind: Member["kind"]) => d.members.filter((m) => m.kind === kind);

const overlap = (a: Member, b: Member) => [0, 1, 2].every((i) => a.min[i] < b.min[i] + b.size[i] - 0.01 && b.min[i] < a.min[i] + a.size[i] - 0.01);

/** No two boards of the same assembly's base share volume, and every board is inside the crate's outline. */
function expectSolidBase(d: CrateDesign) {
  const base = d.members.filter((m) => m.assembly === "base");
  for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) expect(overlap(base[i], base[j])).toBe(false);
  const floor = kinds(d, "floor")[0];
  for (const m of base) {
    expect(m.min[0]).toBeGreaterThanOrEqual(floor.min[0] - 0.01);
    expect(m.min[1]).toBeGreaterThanOrEqual(floor.min[1] - 0.01);
    expect(m.min[0] + m.size[0]).toBeLessThanOrEqual(floor.min[0] + floor.size[0] + 0.01);
    expect(m.min[1] + m.size[1]).toBeLessThanOrEqual(floor.min[1] + floor.size[1] + 0.01);
  }
  // The base's underside is the construction's base height below the floor's top (z = 0).
  expect(memberBounds(base).min[2]).toBeCloseTo(-d.construction.baseMm, 6);
}

describe("the fork-entry standard", () => {
  it("is `ends` by default, and the three values are known", () => {
    expect(DEFAULT_STANDARDS.handling.forkEntry).toBe("ends");
    expect([...FORK_ENTRIES]).toEqual(["ends", "sides", "fourWay"]);
    expect(entryDirections("ends")).toEqual(["ends"]);
    expect(entryDirections("sides")).toEqual(["sides"]);
    expect(entryDirections("fourWay")).toEqual(["ends", "sides"]);
    expect(skidsRunAcross("sides")).toBe(true);
    expect(skidsRunAcross("ends")).toBe(false);
    expect(skidsRunAcross("fourWay")).toBe(false);
  });

  it("reads standards saved before it existed as `ends`", () => {
    const handling: Record<string, unknown> = { ...DEFAULT_STANDARDS.handling };
    delete handling.forkEntry;
    const old = { ...DEFAULT_STANDARDS, handling };
    const r = parseStandards(old);
    expect(r.ok && r.standards.handling.forkEntry).toBe("ends");
    const file = standardsFromJson(JSON.stringify({ kind: "crate-designer/shop-standards", version: 1, standards: old }));
    expect(file.ok && file.standards.handling.forkEntry).toBe("ends");
  });

  it("round-trips through the standards file and rejects an unknown value", () => {
    const r = standardsFromJson(standardsToJson(withEntry("fourWay")));
    expect(r.ok && r.standards.handling.forkEntry).toBe("fourWay");
    expect(parseStandards({ ...DEFAULT_STANDARDS, handling: { ...DEFAULT_STANDARDS.handling, forkEntry: "top" } }).ok).toBe(false);
  });

  it("sizes the lifting block to the taller clearance of the two devices", () => {
    expect(liftHeightMm(DEFAULT_STANDARDS)).toBe(85);
    expect(liftHeightMm(custom({ handling: { forklift: { minClearMm: 120 } } }))).toBe(120);
  });
});

describe("base geometry per entry mode", () => {
  it("ends: skids run along the length, no lifting blocks (as before)", () => {
    const d = build("PART-001", 4, "ends");
    const skids = kinds(d, "skid");
    expect(skids).toHaveLength(d.construction.skidCount);
    const floor = kinds(d, "floor")[0];
    for (const s of skids) expect(s.size[0]).toBeCloseTo(floor.size[0], 6);
    expect(kinds(d, "lift-block")).toHaveLength(0);
    expect(d.construction.forkEntry).toBe("ends");
    expect(d.construction.lift).toBeNull();
    expectSolidBase(d);
  });

  it("sides: skids run across the width, spaced along the length, joists along the length", () => {
    const d = build("PART-003", 8, "sides");
    const floor = kinds(d, "floor")[0];
    const skids = kinds(d, "skid");
    expect(skids.length).toBe(d.construction.skidCount);
    for (const s of skids) {
      expect(s.size[1]).toBeCloseTo(floor.size[1], 6);
      expect(s.size[0]).toBeCloseTo(d.construction.skid.wide, 6);
    }
    // The first and last skids stand at the two ends of the floor.
    expect(Math.min(...skids.map((s) => s.min[0]))).toBeCloseTo(floor.min[0], 6);
    expect(Math.max(...skids.map((s) => s.min[0] + s.size[0]))).toBeCloseTo(floor.min[0] + floor.size[0], 6);
    for (const j of kinds(d, "joist")) expect(j.size[0]).toBeCloseTo(floor.size[0], 6);
    expect(kinds(d, "lift-block")).toHaveLength(0);
    expectSolidBase(d);
  });

  it("sides with joists: the joists run along the length across the skids", () => {
    const d = build("PART-003", 8, "sides");
    const joists = kinds(d, "joist");
    if (d.construction.joist) {
      expect(joists).toHaveLength(d.construction.joist.count);
      for (const j of joists) expect(j.size[1]).toBeCloseTo(d.construction.joist.wide, 6);
    }
    expectSolidBase(d);
  });

  it("four-way: skids along the length on a lifting block under each end", () => {
    const d = build("PART-003", 8, "fourWay");
    const { lift, skid, skidCount } = d.construction;
    expect(lift).toEqual({ long: DEFAULT_STANDARDS.stock.blockWidthMm, tall: 85 });
    const blocks = kinds(d, "lift-block");
    expect(blocks).toHaveLength(2 * skidCount);
    const floor = kinds(d, "floor")[0];
    for (const b of blocks) {
      expect(b.size).toEqual([lift!.long, skid.wide, lift!.tall]);
      expect(b.min[2]).toBeCloseTo(-d.construction.baseMm, 6);
    }
    expect(Math.min(...blocks.map((b) => b.min[0]))).toBeCloseTo(floor.min[0], 6);
    expect(Math.max(...blocks.map((b) => b.min[0] + b.size[0]))).toBeCloseTo(floor.min[0] + floor.size[0], 6);
    // Each skid stands on its blocks, 85 mm up.
    for (const s of kinds(d, "skid")) expect(s.min[2]).toBeCloseTo(-d.construction.baseMm + 85, 6);
    expect(d.construction.baseMm).toBe(build("PART-003", 8, "ends").construction.baseMm + 85);
    expectSolidBase(d);
  });

  it("every mode packs the same interior", () => {
    const ends = build("PART-001", 4, "ends");
    for (const mode of ["sides", "fourWay"] as const) {
      const d = build("PART-001", 4, mode);
      expect(d.layout.interior).toEqual(ends.layout.interior);
    }
  });

  it("every mode builds a complete cut list: lifting blocks and their screws only when four-way", () => {
    for (const mode of FORK_ENTRIES) {
      const d = build("PART-003", 8, mode);
      expect(d.bom.some((l) => l.kind === "lift-block")).toBe(mode === "fourWay");
      expect(d.bom.reduce((n, l) => n + l.qty, 0)).toBe(d.members.length);
    }
  });
});

describe("structural sizing for the new base", () => {
  it("side skids span the width and are spaced by the spacing rule along the length", () => {
    const d = build("PART-003", 8, "sides");
    const ends = build("PART-003", 8, "ends");
    const [extL, extW] = [d.layout.external[0], d.layout.external[1]];
    const spacing = DEFAULT_STANDARDS.construction.skidSpacingMm;
    expect(d.construction.skidCount).toBeGreaterThanOrEqual(Math.max(2, Math.ceil(extL / spacing) + 1));
    expect(d.structure.base.skidOpeningMm).toBeCloseTo((extL - d.construction.skidCount * d.construction.skid.wide) / (d.construction.skidCount - 1), 6);
    // The skid span is the width, not the length: a long, narrow crate gets a lighter skid check than on its ends.
    expect(extW).toBeLessThan(extL);
    const skidBending = (x: CrateDesign) => x.structure.base.checks.find((c) => c.id === "skid-bending")!.capacityKg;
    expect(skidBending(d)).toBeGreaterThan(skidBending(ends) * 0.99);
    expect(d.structure.base.ok).toBe(true);
  });

  it("a four-way skid bears on the block's length, not the full support length", () => {
    const four = build("PART-003", 8, "fourWay");
    const ends = build("PART-003", 8, "ends");
    const bearing = (x: CrateDesign) => x.structure.base.checks.find((c) => c.id === "skid-bearing")!.capacityKg;
    const std = DEFAULT_STANDARDS;
    expect(std.stock.blockWidthMm).toBeLessThan(std.structure.supportLengthMm);
    // Same skid section and count: the bearing capacity falls in proportion to the shorter support.
    if (four.construction.skidCount === ends.construction.skidCount && four.construction.skid.wide === ends.construction.skid.wide) {
      expect(bearing(four) / bearing(ends)).toBeCloseTo(std.stock.blockWidthMm / std.structure.supportLengthMm, 6);
    }
    expect(four.structure.baseMm).toBe(85 + four.construction.skid.tall + (four.construction.joist?.tall ?? 0) + four.construction.floorMm);
  });
});

describe("fork openings per direction", () => {
  it("ends: the openings between the skids, as before", () => {
    const d = build("PART-003", 8, "ends");
    const [e] = d.handling.entries;
    expect(e.direction).toBe("ends");
    expect(e.openings).toHaveLength(d.construction.skidCount - 1);
    expect(e.openings[0].clearMm).toBe(d.construction.skid.tall);
  });

  it("sides: the openings between the side skids, measured along X", () => {
    const d = build("PART-003", 8, "sides");
    expect(d.handling.entries.map((e) => e.direction)).toEqual(["sides"]);
    const [e] = d.handling.entries;
    expect(e.openings).toHaveLength(d.construction.skidCount - 1);
    expect(e.openings[0].width).toBeCloseTo(d.structure.base.skidOpeningMm, 6);
    expect(e.openings[0].y).toBeCloseTo(kinds(d, "skid")[0].min[0] + d.construction.skid.wide, 6);
  });

  it("four-way: between the skids from the ends (full height), under them between the blocks from the sides", () => {
    const d = build("PART-003", 8, "fourWay");
    expect(d.handling.entries.map((e) => e.direction)).toEqual(["ends", "sides"]);
    const [ends, sides] = d.handling.entries;
    expect(ends.openings).toHaveLength(d.construction.skidCount - 1);
    expect(ends.openings[0].clearMm).toBe(85 + d.construction.skid.tall);
    expect(sides.openings).toHaveLength(1);
    expect(sides.openings[0].clearMm).toBe(85);
    expect(sides.openings[0].width).toBeCloseTo(d.layout.external[0] - 2 * d.construction.lift!.long, 6);
    expect(forkOpenings(d.members, "sides")).toEqual(sides.openings);
  });

  it("the crate stands on the lifting blocks: the ground, tip angle and base are theirs", () => {
    const four = build("PART-001", 4, "fourWay");
    const ends = build("PART-001", 4, "ends");
    expect(four.handling.groundZ).toBeCloseTo(-four.construction.baseMm, 6);
    // The centre of gravity rises by the block height, less a little: the blocks are light.
    expect(Math.abs(four.handling.heightMm - ends.handling.heightMm - 85)).toBeLessThan(5);
    expect(four.handling.tipAngleDeg).toBeLessThan(ends.handling.tipAngleDeg);
  });
});

describe("the fork and pallet-jack checks name each direction", () => {
  it("ends (default): the original words, one direction", () => {
    const d = build("PART-003", 8, "ends");
    expect(check(d.checks, "forklift").title).toBe("Forklift fits from the ends");
    expect(metric(check(d.checks, "forklift").detail)).toContain("Forklift: fits from the ends");
  });

  it("sides: passes from the sides and says so", () => {
    const d = build("PART-003", 8, "sides");
    expect(check(d.checks, "forklift")).toMatchObject({ level: "ok", title: "Forklift fits from the sides" });
    expect(metric(check(d.checks, "forklift").detail)).toMatch(
      /^Forklift: fits from the sides, \d+ mm clear under the floor, needs 75 mm\. Room between the skids/,
    );
    expect(check(d.checks, "pallet-jack").title).toBe("Pallet jack fits from the sides");
  });

  it("sides: a forklift-only crate names the side in the pallet-jack note", () => {
    const d = build("PART-001", 1, "sides");
    const jack = check(d.checks, "pallet-jack");
    expect(jack.level).toBe("ok");
    expect(jack.title).toBe("Pallet jack won't fit from the sides: use a forklift");
    expect(metric(jack.detail)).toMatch(/^From the sides: The widest gap between the skids is \d+ mm\./);
  });

  it("four-way: one row per device, naming both directions, passing when both pass", () => {
    const d = build("PART-003", 8, "fourWay");
    const fork = check(d.checks, "forklift");
    expect(fork).toMatchObject({ level: "ok", title: "Forklift fits from all four sides" });
    const text = metric(fork.detail);
    expect(text).toContain("Forklift: fits from the ends");
    expect(text).toContain("Forklift: fits from the sides");
    expect(text).toContain("between the lifting blocks");
    expect(check(d.checks, "pallet-jack").title).toBe("Pallet jack fits from all four sides");
  });

  it("four-way: a crate the jack passes from one side only says which side to use a forklift for", () => {
    const d = build("PART-001", 4, "fourWay");
    const jack = check(d.checks, "pallet-jack");
    expect(jack.level).toBe("ok");
    expect(jack.title).toBe("Pallet jack won't fit from the ends: use a forklift");
    expect(metric(jack.detail)).toContain("From the ends:");
  });

  it("four-way: fails, naming the direction, when only one direction is too low", () => {
    // Pallet jack needs 90 mm; four-way lifting blocks are built to the taller clearance, so make the ends the short one.
    const d = build("PART-003", 8, "fourWay");
    const lowEnds = {
      ...d.handling,
      entries: d.handling.entries.map((e) =>
        e.direction === "ends"
          ? {
              ...e,
              openings: e.openings.map((o) => ({ ...o, clearMm: 40 })),
              devices: e.devices.map((x) => ({ ...x, fits: false, problem: "height" as const, clearMm: 40 })),
            }
          : e,
      ),
    };
    const checks = handlingChecks(lowEnds);
    const fork = check(checks, "forklift");
    expect(fork.level).toBe("caution");
    expect(fork.title).toBe("Forklift may not fit from the ends");
    const text = metric(fork.detail);
    expect(text).toContain("Forklift: enters from the ends, 40 mm clear under the floor, needs 75 mm. Use taller skids.");
    expect(text).toContain("Forklift: fits from the sides");
  });

  it("four-way: names both directions when both fail, in metric and in the detail", () => {
    const d = build("PART-002", 1, "fourWay");
    const jack = check(d.checks, "pallet-jack");
    const fork = check(d.checks, "forklift");
    expect(fork.level).toBe("caution");
    expect(fork.title).toBe("Forklift may not fit from the ends");
    expect(jack.level).toBe("caution");
    expect(metric(fork.detail)).toContain("From the");
  });

  it("sides: a gap too small for the tines fails from the sides", () => {
    // A forklift that needs 400 mm between its tines doesn't fit the 344 mm gap between this crate's two side skids.
    const wide = custom({ handling: { forkEntry: "sides", forklift: { spreadMm: { min: 400 } } } });
    const d = designOf(getPart("PART-001"), { quantity: 1 }, wide);
    expect(check(d.checks, "forklift")).toMatchObject({ level: "caution", title: "Forklift may not fit from the sides" });
    expect(metric(check(d.checks, "forklift").detail)).toMatch(/^From the sides: Forklift: the widest opening between the skids is \d+ mm; it needs room/);
  });

  it("the hand-carry pass still stands in for both devices, whatever the entry", () => {
    const light = custom({ handling: { forkEntry: "fourWay", handCarryMaxKg: 200 } });
    const d = designOf(getPart("PART-002"), { quantity: 1 }, light);
    expect(check(d.checks, "hand-carry").level).toBe("ok");
    expect(d.checks.some((c) => c.id === "forklift")).toBe(false);
  });

  it("analyseHandling reports the standard's entry", () => {
    const d = build("PART-003", 8, "sides");
    const h = analyseHandling(d.members, d.layout, 1, withEntry("sides"));
    expect(h.forkEntry).toBe("sides");
    expect(h.entries).toHaveLength(1);
  });
});
