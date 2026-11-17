import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { FORK_ENTRIES, type ForkEntry } from "@/domain/forkEntry";
import { planShipment } from "@/domain/shipment";
import { custom } from "@/domain/testFixtures";
import { printableToPdf } from "./exportPdf";
import { renderMessage } from "./message";
import { buildPrintable } from "./printable";
import type { Units } from "./units";

/** The shipping label, the build sheet and the checks follow the fork-entry standard (#112). */
const NOW = "2026-11-16T12:00:00.000Z";
const part = getPart("PART-003");

function doc(forkEntry: ForkEntry, units: Units = "imperial", quantity = 8) {
  const standards = custom({ handling: { forkEntry } });
  const plan = planShipment(part, { ...DEFAULT_SETTINGS, quantity }, null, standards);
  return buildPrintable({ part, plan, standards, units, ranking: "volume", generatedAt: NOW });
}

describe("the shipping label per fork entry", () => {
  it("says where the forks go", () => {
    expect(doc("ends").crates[0].label.forkEntry).toBe("Fork entry from the ends");
    expect(doc("sides").crates[0].label.forkEntry).toBe("Fork entry from the sides");
    expect(doc("fourWay").crates[0].label.forkEntry).toBe("Fork entry from all four sides");
  });

  it("draws the end for end entry, the side for side entry and both for four-way", () => {
    expect(doc("ends").crates[0].label.views.map((v) => v.name)).toEqual(["End"]);
    expect(doc("sides").crates[0].label.views.map((v) => v.name)).toEqual(["Side"]);
    expect(doc("fourWay").crates[0].label.views.map((v) => v.name)).toEqual(["End", "Side"]);
  });

  it("sizes each view to the face it looks at and puts the arrows in the measured openings", () => {
    for (const entry of FORK_ENTRIES) {
      const { label } = doc(entry).crates[0];
      for (const v of label.views) {
        expect(v.heightMm).toBeGreaterThan(0);
        expect(v.openings.length).toBeGreaterThan(0);
        // Every opening lies between two feet, along the view's width.
        for (const o of v.openings) {
          expect(o.y).toBeGreaterThanOrEqual(0);
          expect(o.y + o.w).toBeLessThanOrEqual(v.widthMm + 1e-6);
        }
        expect(v.cog.y).toBeGreaterThan(0);
        expect(v.cog.y).toBeLessThan(v.widthMm);
      }
    }
    const sides = doc("sides").crates[0];
    const [view] = sides.label.views;
    // The side view is as wide as the crate is long: the skids across the width are seen end on, spaced along it.
    expect(view.widthMm).toBeCloseTo(1102, 0);
    expect(view.feet.every((f) => f.z === 0 && f.w === 89)).toBe(true);
  });

  it("four-way: the side view shows the skid on its blocks, the arrow into the gap between the blocks", () => {
    const [end, side] = doc("fourWay").crates[0].label.views;
    // Blocks 85 mm under a skid 89 mm tall, so the body of the crate starts 174 mm up.
    expect(side.baseMm).toBe(174);
    expect(end.baseMm).toBe(174);
    expect(side.feet.filter((f) => f.z === 0)).toHaveLength(2);
    expect(side.feet.filter((f) => f.z === 85)).toHaveLength(1);
    expect(side.openings).toHaveLength(1);
    expect(side.tipMm).toBe(85 / 2);
    // From the end the blocks stand under the skids, so the gap between skids is the full 174 mm.
    expect(end.tipMm).toBe(174 / 2);
  });

  it("is printed on the PDF label", () => {
    for (const [entry, text] of [
      ["ends", "FORK ENTRY FROM THE ENDS"],
      ["sides", "FORK ENTRY FROM THE SIDES"],
      ["fourWay", "FORK ENTRY FROM ALL FOUR SIDES"],
    ] as const) {
      const pdf = new TextDecoder("latin1").decode(printableToPdf(doc(entry)));
      expect(pdf.includes(`(${text}`), text).toBe(true);
    }
  });
});

describe("the build sheet per fork entry", () => {
  const step = (e: ForkEntry, units: Units = "imperial") => doc(e, units).crates[0].build.steps[0].text;

  it("lays the skids the way the entry says", () => {
    expect(step("ends")).toMatch(/skids along the length, evenly spread across the .* width/);
    expect(step("ends")).toContain("Forklift tines go between the skids from the ends.");
    expect(step("sides")).toMatch(/skids across the width, evenly spread along the .* length/);
    expect(step("sides")).toContain("from the sides.");
    expect(step("fourWay")).toContain("lifting block (");
    expect(step("fourWay")).toContain(") screwed under each end of every skid");
    expect(step("fourWay")).toContain("under the skids between the lifting blocks from the sides");
  });

  it("gives the lifting block's size in the selected units", () => {
    expect(step("fourWay", "imperial")).toMatch(/3 3\/8″ high/);
    expect(step("fourWay", "metric")).toMatch(/85 mm high/);
  });

  it("lists the lifting blocks in the cut list and the screws, only for four-way", () => {
    const four = doc("fourWay").crates[0].build;
    expect(four.cutList.some((g) => g.lines.some((l) => l.piece === "Lifting block" && l.qty === 6))).toBe(true);
    expect(four.fasteners.some((f) => f.title === "Lifting blocks to skids")).toBe(true);
    for (const e of ["ends", "sides"] as const) {
      const b = doc(e).crates[0].build;
      expect(b.cutList.some((g) => g.lines.some((l) => l.piece === "Lifting block"))).toBe(false);
      expect(b.fasteners.some((f) => f.title === "Lifting blocks to skids")).toBe(false);
    }
  });
});

describe("the handling checks per fork entry, in both unit systems", () => {
  const check = (e: ForkEntry, id: string, units: Units) => {
    const c = doc(e, units).crates[0].spec.checks.find((k) => k.id === id)!;
    return c;
  };

  it("name the direction and give sizes in the selected units", () => {
    const metric = check("fourWay", "forklift", "metric");
    const imperial = check("fourWay", "forklift", "imperial");
    expect(metric.title).toBe("Forklift fits from all four sides");
    expect(metric.detail).toContain("Forklift: fits from the ends, 174 mm clear under the floor");
    expect(metric.detail).toContain("Forklift: fits from the sides, 85 mm clear under the floor");
    expect(imperial.detail).toContain("Forklift: fits from the sides, 3 3/8″ clear under the floor");
  });

  it("render the same message in both systems with the direction", () => {
    const standards = custom({ handling: { forkEntry: "sides" } });
    const plan = planShipment(part, { ...DEFAULT_SETTINGS, quantity: 8 }, null, standards);
    const c = plan.crates[0].result.design!.checks.find((k) => k.id === "forklift")!;
    expect(renderMessage(c.detail, "metric")).toMatch(/^Forklift: fits from the sides, \d+ mm clear/);
    expect(renderMessage(c.detail, "imperial")).toMatch(/^Forklift: fits from the sides, [\d /]+″ clear/);
  });
});
