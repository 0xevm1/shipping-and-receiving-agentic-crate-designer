import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { screwSchedule } from "./bom";
import { fitsSheet, planSplit, sheetCount, SHEET_WASTE_ALLOWANCE, type Backer } from "./sheets";
import { DEFAULT_STANDARDS, ShopStandardsSchema } from "./standards";
import { custom, designOf, metricText } from "./testFixtures";

/** A 4 × 8 ft sheet, as shipped. */
const SHEET = { width: 1220, length: 2440 };
const NONE: readonly [readonly Backer[], readonly Backer[]] = [[], []];

describe("fitsSheet", () => {
  it("lets a sheet be turned", () => {
    expect(fitsSheet(2440, 1220, SHEET)).toBe(true);
    expect(fitsSheet(1220, 2440, SHEET)).toBe(true);
    expect(fitsSheet(2441, 1220, SHEET)).toBe(false);
    expect(fitsSheet(1300, 1300, SHEET)).toBe(false);
  });
});

describe("planSplit", () => {
  it("leaves a panel that fits whole", () => {
    expect(planSplit([2000, 1000], SHEET, 89, NONE)).toEqual({ cuts: [[], []] });
  });

  it("splits a long panel in the fewest equal pieces, turning the sheet the way that needs fewer", () => {
    // 3000 × 1000: sheet long side along the 3000 needs 2 pieces; short side along it needs 3.
    const split = planSplit([3000, 1000], SHEET, 89, NONE)!;
    expect(split.cuts[0]).toEqual([{ at: 1500, backed: false }]);
    expect(split.cuts[1]).toEqual([]);
    // 3000 × 1500: [3000 long-wise → 2] x [1500 needs 2 of 1220] = 4, or [3000/1220 → 3] x [1500 ≤ 2440 → 1] = 3 pieces.
    const turned = planSplit([3000, 1500], SHEET, 89, NONE)!;
    expect(turned.cuts[0]).toHaveLength(2);
    expect(turned.cuts[1]).toHaveLength(0);
  });

  it("splits both ways when a panel is bigger than a sheet on both sides", () => {
    const split = planSplit([3000, 3000], SHEET, 89, NONE)!;
    expect(split.cuts[0].length + split.cuts[1].length).toBeGreaterThanOrEqual(2);
  });

  it("moves a seam onto a backing board within reach, and not onto a narrow one", () => {
    const upright: Backer = { center: 1400, width: 89 };
    expect(planSplit([3000, 1000], SHEET, 89, [[upright], []])!.cuts[0]).toEqual([{ at: 1400, backed: true }]);
    // Too far from the even split (1500) to be worth moving.
    expect(planSplit([3000, 1000], SHEET, 89, [[{ center: 800, width: 89 }], []])!.cuts[0][0].backed).toBe(false);
    // Too narrow to back a joint.
    expect(planSplit([3000, 1000], SHEET, 89, [[{ center: 1500, width: 19 }], []])!.cuts[0][0].backed).toBe(false);
  });

  it("never moves a seam so far that a piece is bigger than the sheet", () => {
    const split = planSplit([2500, 1000], SHEET, 89, [
      [
        { center: 60, width: 89 },
        { center: 2440, width: 89 },
      ],
      [],
    ])!;
    const at = split.cuts[0][0].at;
    expect(at).toBeLessThanOrEqual(2440);
    expect(2500 - at).toBeLessThanOrEqual(2440);
  });

  it("gives up when the sheet is too small for a piece to take a joint cleat", () => {
    expect(planSplit([1000, 1000], { width: 150, length: 150 }, 89, NONE)).toBeNull();
  });
});

describe("sheetCount", () => {
  it("is the area plus the allowance over a sheet's area, rounded up", () => {
    const sheetM2 = (1220 * 2440) / 1e6;
    expect(sheetCount(0, SHEET, SHEET_WASTE_ALLOWANCE)).toBe(0);
    expect(sheetCount(0.1, SHEET, SHEET_WASTE_ALLOWANCE)).toBe(1);
    expect(sheetCount(sheetM2 * 2, SHEET, 0)).toBe(2);
    expect(sheetCount(sheetM2 * 2, SHEET, SHEET_WASTE_ALLOWANCE)).toBe(3);
  });
});

describe("a crate with panels bigger than a sheet", () => {
  const part = getPart("PART-002");
  const big = custom({ stock: { sheetMm: { width: 6000, length: 6000 } } });
  const spliced = designOf(part, { quantity: 42 });
  const whole = designOf(part, { quantity: 42 }, big);
  const plywood = (d: typeof spliced, kind: string) => d.members.filter((m) => m.kind === kind);

  it("is the same crate with the same outside", () => {
    expect(spliced.layout.external).toEqual(whole.layout.external);
    expect(whole.splices.seams).toBe(0);
    expect(whole.checks.some((c) => c.id === "spliced")).toBe(false);
  });

  it("cuts the floor, walls and lid into pieces that each fit a sheet", () => {
    for (const m of spliced.members.filter((x) => x.material === "plywood" && ["floor", "side", "end", "lid"].includes(x.kind))) {
      const [a, b] = [...m.size].sort((p, q) => q - p);
      expect(fitsSheet(a, b, SHEET)).toBe(true);
    }
    expect(plywood(spliced, "floor").length).toBeGreaterThan(1);
    expect(spliced.members.filter((m) => m.variant === "joint-cleat").length).toBeGreaterThan(0);
    expect(plywood(spliced, "lid").length).toBeGreaterThan(1);
  });

  it("keeps the panels' area: the pieces tile the panel exactly", () => {
    for (const kind of ["floor", "side", "end", "lid"]) {
      const area = (d: typeof spliced) =>
        plywood(d, kind).reduce(
          (n, m) =>
            n +
            [...m.size]
              .sort((p, q) => q - p)
              .slice(0, 2)
              .reduce((x, y) => x * y, 1),
          0,
        );
      expect(area(spliced)).toBeCloseTo(area(whole), 3);
    }
  });

  it("counts every seam, and the check says how many", () => {
    const { seams, spliced: panels } = spliced.splices;
    expect(seams).toBe(panels.reduce((n, p) => n + p.seams, 0));
    expect(seams).toBeGreaterThan(0);
    const check = spliced.checks.find((c) => c.id === "spliced")!;
    expect(check.level).toBe("info");
    expect(check.title).toBe(`Panels are spliced: ${seams} seams`);
    expect(metricText(check.detail)).toContain("1,220 mm × 2,440 mm");
  });

  it("puts a joint cleat of the cleat stock behind each seam with nothing behind it, and none where an upright is", () => {
    const joints = spliced.members.filter((m) => m.variant === "joint-cleat");
    const { thick, wide } = spliced.construction.cleat;
    for (const j of joints) {
      expect(j.label).toBe("Panel joint cleat");
      expect(j.material).toBe("lumber");
      const sides = [...j.size].sort((p, q) => p - q);
      expect(sides[0]).toBeCloseTo(thick);
      expect(sides[1]).toBeCloseTo(wide);
    }
  });

  it("follows into the cut list, weight, screws and cost", () => {
    const joints = spliced.members.filter((m) => m.variant === "joint-cleat");
    expect(joints.length).toBeGreaterThan(0);
    {
      expect(spliced.bom.filter((l) => l.variant === "joint-cleat").reduce((n, l) => n + l.qty, 0)).toBe(joints.length);
      expect(spliced.lumberM).toBeGreaterThan(whole.lumberM);
      const jointScrews = screwSchedule(spliced.members, spliced.layout.interior, DEFAULT_STANDARDS).filter((l) => /joint cleats/.test(l.title));
      expect(jointScrews.reduce((n, l) => n + l.qty, 0)).toBeGreaterThan(0);
      expect(spliced.screws).toBeGreaterThan(whole.screws);
    }
    expect(spliced.tareKg).toBeGreaterThanOrEqual(whole.tareKg);
    expect(spliced.cost.totalUsd).toBeGreaterThan(whole.cost.totalUsd);
  });

  it("does not overlap a joint cleat with any other board", () => {
    const joints = spliced.members.filter((m) => m.variant === "joint-cleat");
    const overlap = (a: (typeof joints)[0], b: (typeof joints)[0]) =>
      [0, 1, 2].every((i) => a.min[i] < b.min[i] + b.size[i] - 0.01 && b.min[i] < a.min[i] + a.size[i] - 0.01);
    for (const j of joints) {
      for (const m of spliced.members) if (m !== j && m.material === "lumber") expect(overlap(j, m)).toBe(false);
    }
  });
});

describe("sheets needed", () => {
  it("counts plywood by thickness: area plus the 15% allowance over one sheet", () => {
    const d = designOf(getPart("PART-001"), { quantity: 4 });
    expect(d.sheets.allowance).toBe(SHEET_WASTE_ALLOWANCE);
    expect(d.sheets.sheetMm).toEqual(SHEET);
    expect(d.sheets.total).toBe(d.sheets.lines.reduce((n, l) => n + l.sheets, 0));
    for (const l of d.sheets.lines) expect(l.sheets).toBe(sheetCount(l.areaM2, SHEET, SHEET_WASTE_ALLOWANCE));
    // The pieces' area is the plywood area the crate reports.
    expect(d.sheets.lines.reduce((n, l) => n + l.areaM2, 0)).toBeCloseTo(d.plywoodM2, 6);
  });

  it("follows the sheet size in the shop standards", () => {
    const part = getPart("PART-001");
    const small = designOf(part, { quantity: 4 }, custom({ stock: { sheetMm: { width: 600, length: 1200 } } }));
    expect(small.sheets.total).toBeGreaterThan(designOf(part, { quantity: 4 }).sheets.total);
  });
});

describe("lumber longer than the stock", () => {
  const part = getPart("PART-002");
  it("raises a caution naming the boards when one is over the longest lumber", () => {
    const d = designOf(part, { quantity: 42 }, custom({ stock: { maxLumberLengthMm: 4000 } }));
    const check = d.checks.find((c) => c.id === "lumber-length")!;
    expect(check.level).toBe("caution");
    expect(metricText(check.detail)).toContain("skid");
    expect(metricText(check.detail)).toContain("4,000 mm");
  });
  it("is silent when every board is within the stock", () => {
    expect(designOf(part, { quantity: 42 }).checks.some((c) => c.id === "lumber-length")).toBe(false);
    expect(designOf(part, { quantity: 4 }).checks.some((c) => c.id === "lumber-length")).toBe(false);
  });
});

describe("a sheet too small to splice", () => {
  it("leaves the panels whole and raises a caution", () => {
    const d = designOf(getPart("PART-002"), { quantity: 4 }, custom({ stock: { cleatMm: { thick: 19, wide: 200 }, sheetMm: { width: 300, length: 300 } } }));
    expect(d.splices.unsplit.length).toBeGreaterThan(0);
    expect(d.splices.seams).toBe(0);
    const check = d.checks.find((c) => c.id === "spliced")!;
    expect(check.level).toBe("caution");
    expect(check.title).toMatch(/can't be split/);
  });
});

describe("standards saved before the sheet size existed", () => {
  it("read with the 4 × 8 ft sheet and 16 ft lumber", () => {
    const old = structuredClone(DEFAULT_STANDARDS) as unknown as { stock: Record<string, unknown> };
    delete old.stock.sheetMm;
    delete old.stock.maxLumberLengthMm;
    const r = ShopStandardsSchema.parse(old);
    expect(r.stock.sheetMm).toEqual({ width: 1220, length: 2440 });
    expect(r.stock.maxLumberLengthMm).toBe(4880);
  });
});
