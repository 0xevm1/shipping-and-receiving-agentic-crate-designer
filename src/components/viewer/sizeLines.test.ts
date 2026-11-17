import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { buildLines, crateLabelAnchors, hiddenAxis, labelOffsetMm, labelText, separatePills, type PillBox } from "./sizeLines";

function design(quantity = 4) {
  const d = computeDesign(getPart("PART-001"), { ...DEFAULT_SETTINGS, quantity }).design;
  if (!d) throw new Error("no design");
  return d;
}

describe("buildLines", () => {
  const d = design();

  it("crate: three labels (length, width, height); with the part, one more pill holding its three sizes", () => {
    const crate = buildLines(d, false);
    expect(crate.labels.map((l) => l.values)).toEqual(d.layout.external.map((x) => [x]));
    expect(crate.labels.some((l) => l.inner)).toBe(false);

    const withPart = buildLines(d, true);
    expect(withPart.labels).toHaveLength(4);
    expect(withPart.labels[3]).toMatchObject({ where: "part", inner: true, values: [...d.layout.cellSize] });
    // The pulses still run along each of the part's three edges.
    expect(withPart.anchors.filter((a) => a.where === "part")).toHaveLength(3);
    expect(withPart.lines.part).toHaveLength(3);
  });

  it.each([
    ["top", "height", ["front", "right"]],
    ["front", "width", ["front", "right"]],
    ["end", "length", ["right"]],
  ] as const)("the %s preset leaves out the %s dimension", (preset, axis, where) => {
    expect(hiddenAxis(preset)).toBe(axis);
    const all = buildLines(d, false);
    const some = buildLines(d, false, axis);
    expect(some.labels).toHaveLength(2);
    expect(some.anchors).toHaveLength(2);
    const wanted = axis === "length" ? [d.layout.external[1], d.layout.external[2]] : axis === "width" ? [d.layout.external[0], d.layout.external[2]] : [d.layout.external[0], d.layout.external[1]];
    expect(some.labels.map((l) => l.values[0])).toEqual(wanted);
    expect(new Set(some.labels.map((l) => l.where))).toEqual(new Set(where));
    expect(some.lines.front.length + some.lines.right.length).toBeLessThan(all.lines.front.length + all.lines.right.length);
    // Every anchor still points at its own dimension line.
    for (const a of some.anchors) expect(some.lines[a.where][a.seg]).toBeDefined();
  });

  it("iso and a free camera leave every dimension in", () => {
    expect(hiddenAxis("iso")).toBeNull();
    expect(hiddenAxis(null)).toBeNull();
  });

  it("the crate's label anchors slide out with their walls when exploded", () => {
    const [l0, w0, h0] = crateLabelAnchors(d, 0);
    const [l1, w1, h1] = crateLabelAnchors(d, 1);
    expect(l1[1]).toBeLessThan(l0[1]); // length line follows the front wall out (−Y)
    expect(w1[0]).toBeGreaterThan(w0[0]); // width and height follow the right wall out (+X)
    expect(h1[0]).toBeGreaterThan(h0[0]);
  });

  it("the label offset is 110 mm plus 5 % of the longest side", () => {
    expect(labelOffsetMm([1000, 500, 400])).toBe(160);
  });
});

describe("labelText", () => {
  it("one value, or three joined with ×, in the displayed unit", () => {
    expect(labelText({ values: [932] }, "metric")).toBe("932 mm");
    expect(labelText({ values: [360, 220, 260] }, "metric")).toBe("360 × 220 × 260 mm");
    expect(labelText({ values: [25.4, 50.8, 254] }, "imperial")).toBe("1.0 × 2.0 × 10.0 in");
  });
});

describe("separatePills", () => {
  const touching = (a: PillBox, b: PillBox) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

  it("leaves pills that already clear each other alone", () => {
    const pills = [
      { x: 0, y: 0, w: 60, h: 20 },
      { x: 200, y: 5, w: 60, h: 20 },
    ];
    separatePills(pills);
    expect(pills.map((p) => p.y)).toEqual([0, 5]);
  });

  it("moves a later pill clear of an earlier one the shorter way, and never moves the first", () => {
    const pills = [
      { x: 100, y: 100, w: 60, h: 20 },
      { x: 120, y: 108, w: 130, h: 20 },
    ];
    separatePills(pills);
    expect(pills[0].y).toBe(100);
    expect(touching(pills[0], pills[1])).toBe(false);
    // 108 is nearer the bottom of the first pill than its top, so it steps down.
    expect(pills[1].y).toBeGreaterThan(108);
  });

  it("clears several pills at once", () => {
    const pills = [
      { x: 100, y: 100, w: 70, h: 20 },
      { x: 110, y: 104, w: 70, h: 20 },
      { x: 105, y: 102, w: 140, h: 20 },
    ];
    separatePills(pills);
    for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) expect(touching(pills[i], pills[j])).toBe(false);
  });
});
