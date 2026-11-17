import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { planShipment } from "@/domain/shipment";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards } from "@/domain/standards";
import { custom as mergeStandardsOk } from "@/domain/testFixtures";
import type { DesignPart } from "@/domain/schema";
import { bomToCsv, shipmentToCsv } from "./csv";

const part = getPart("PART-001");
const design = computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 4 }).design!;

/** CSV text split into lines, without the trailing empty line. */
const lines = (csv: string) => csv.trimEnd().split("\n");
const rows = (csv: string) => lines(csv).filter((l) => !l.startsWith("#"));

describe("cut list CSV in the selected units (#15)", () => {
  it("imperial: inches and pounds in the header, fractional cuts and nominal stock", () => {
    const csv = bomToCsv(part, design, "imperial");
    const head = lines(csv).slice(0, 6);
    expect(head).toEqual([
      "# Crate for 4 x PART-001 Machined steel bracket",
      "# Part 4140 steel, 47.4 lb each",
      `# External 36.7 x 25.7 x 19.6 in, gross ${Math.round(design.grossKg * 2.20462)} lb`,
      expect.stringMatching(/^# Layout 2 x 2 x 1, /),
      "# Units: inches (cuts to the nearest 1/16) and pounds; lumber by nominal size",
      "component,material,stock,cut_in,qty",
    ]);
    const body = rows(csv).slice(1);
    expect(body).toContain(body.find((r) => /^Base: Skid,lumber,4x4,\d+( \d+\/\d+)? in,\d+$/.test(r)));
    expect(body.some((r) => /,lumber,1x4,/.test(r))).toBe(true);
    expect(body.some((r) => /,plywood,1\/2 in,\d+( \d+\/\d+)? in x \d+( \d+\/\d+)? in,\d+$/.test(r))).toBe(true);
    expect(body.some((r) => /,plywood,3\/4 in,/.test(r))).toBe(true);
    // Blocking is cut to the 50 mm gap, from 4x4 stock.
    expect(body.some((r) => /^Inside the crate: Blocking post,lumber,1 15\/16 in x 3 1\/2 in from 4x4,/.test(r))).toBe(true);
    // Plain ASCII: no ″ or × that a spreadsheet could garble.
    expect(csv).toMatch(/^[\x20-\x7e\n]*$/);
    expect(lines(csv).at(-1)).toBe(`Wood screws (approx),fastener,,,${design.screws}`);
  });

  it("metric: millimetres and kilograms, as before", () => {
    const csv = bomToCsv(part, design, "metric");
    expect(lines(csv).slice(0, 6)).toEqual([
      "# Crate for 4 x PART-001 Machined steel bracket",
      "# Part 4140 steel, 21.5 kg each",
      `# External 932 x 652 x 497 mm, gross ${Math.round(design.grossKg)} kg`,
      expect.stringMatching(/^# Layout 2 x 2 x 1, /),
      "# Units: mm and kg",
      "component,material,stock,cut_mm,qty",
    ]);
    expect(rows(csv).slice(1)).toContain(rows(csv).find((r) => /^Base: Skid,lumber,89 × 89,\d+,\d+$/.test(r)));
    expect(csv).toMatch(/,plywood,12 mm,\d+ x \d+,/);
  });

  it("has the same rows and quantities in both units", () => {
    const qty = (csv: string) =>
      rows(csv)
        .slice(1)
        .map((r) => [r.split(",")[0], r.split(",").at(-1)]);
    expect(qty(bomToCsv(part, design, "imperial"))).toEqual(qty(bomToCsv(part, design, "metric")));
  });

  it("does the same for a whole shipment", () => {
    const r = parseStandards(mergeStandards(DEFAULT_STANDARDS, { limits: { perCrate: { maxParts: 4 } } }));
    if (!r.ok) throw new Error(r.error);
    const plan = planShipment(getPart("PART-003"), { ...DEFAULT_SETTINGS, quantity: 10 }, null, r.standards);
    expect(plan.split).toBe(true);
    const imperial = shipmentToCsv(getPart("PART-003"), plan, "imperial");
    const metric = shipmentToCsv(getPart("PART-003"), plan, "metric");
    expect(imperial).toMatch(/\n# \d+ crates, gross \d+ lb in all; quantities are for every crate\n/);
    expect(imperial).toContain("\n# Units: inches (cuts to the nearest 1/16) and pounds; lumber by nominal size\ncomponent,material,stock,cut_in,qty\n");
    expect(metric).toMatch(/\n# \d+ crates, gross \d+ kg in all; quantities are for every crate\n/);
    expect(metric).toContain("\n# Units: mm and kg\ncomponent,material,stock,cut_mm,qty\n");
    expect(imperial).toMatch(/^[\x20-\x7e\n]*$/);
  });
});

describe("entered details on the cut list", () => {
  const part: DesignPart = { id: "widget", name: "Gear housing", material: "6061-T6 aluminum", mass_kg: 3.25, dimensions_mm: [300, 200, 100] };
  const design = computeDesign(part, { ...DEFAULT_SETTINGS, quantity: 2 }).design!;

  it("puts the name, material and mass in the CSV header", () => {
    const lines = bomToCsv(part, design, "metric").split("\n");
    expect(lines[0]).toBe("# Crate for 2 x widget Gear housing");
    expect(lines[1]).toBe("# Part 6061-T6 aluminum, 3.25 kg each");
  });

  it("says when no material was given", () => {
    expect(bomToCsv({ ...part, material: undefined }, design, "metric")).toContain("# Part material not given, 3.25 kg each");
  });
});

describe("shipment CSV header and footer", () => {
  it("names the crate types and ends with the screw total", () => {
    const plan = planShipment(getPart("PART-003"), { ...DEFAULT_SETTINGS, quantity: 10 }, null, mergeStandardsOk({ limits: { perCrate: { maxParts: 4 } } }));
    const screws = plan.crates.reduce((n, c) => n + c.count * c.result.design!.screws, 0);
    const csv = shipmentToCsv(getPart("PART-003"), plan, "metric");
    expect(csv).toMatch(/^# Shipment of 10 x PART-003 .*: 2 x crate A \(4 each\) \+ 1 x crate B \(2\)\n/);
    expect(csv).toContain("# 3 crates, gross");
    expect(csv.trim().endsWith(`Wood screws (approx),fastener,,,${screws}`)).toBe(true);
  });
});
