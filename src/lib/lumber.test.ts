import { describe, expect, it } from "vitest";
import { lumberText, nominalLumber, NOMINAL_LUMBER, plywoodText, sectionText } from "./lumber";

describe("nominal lumber names", () => {
  it.each([
    [19, 89, "1x4"],
    [38, 89, "2x4"],
    [89, 89, "4x4"],
    [89, 140, "4x6"],
    [19, 140, "1x6"],
    [38, 140, "2x6"],
    [38, 184, "2x8"],
    [140, 140, "6x6"],
  ])("%i × %i mm is a %s", (t, w, name) => {
    expect(nominalLumber(t, w)).toBe(name);
  });

  it("ignores the order and a millimetre of rounding", () => {
    expect(nominalLumber(89, 19)).toBe("1x4");
    expect(nominalLumber(140, 89)).toBe("4x6");
    expect(nominalLumber(38.1, 88.9)).toBe("2x4");
    expect(nominalLumber(20, 90)).toBe("1x4");
  });

  it("has no name for a size that isn't stock", () => {
    expect(nominalLumber(25, 100)).toBeNull();
    expect(nominalLumber(50, 89)).toBeNull();
  });

  it("lists every section thinner-first with unique names", () => {
    const names = NOMINAL_LUMBER.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of NOMINAL_LUMBER) expect(n.mm[0]).toBeLessThanOrEqual(n.mm[1]);
  });
});

describe("plywood thickness", () => {
  it.each([
    [6, "1/4″"],
    [9, "3/8″"],
    [12, "1/2″"],
    [15, "5/8″"],
    [18, "3/4″"],
    [19, "3/4″"],
    [25, "1″"],
  ])("%i mm is sold as %s", (mm, text) => {
    expect(plywoodText(mm)).toBe(text);
  });

  it("falls back to the nearest 1/16″ for other thicknesses", () => {
    expect(plywoodText(22)).toBe("7/8″");
    expect(plywoodText(30)).toBe("1 3/16″");
  });

  it("takes another inch mark, for the CSV", () => {
    expect(plywoodText(12, " in")).toBe("1/2 in");
    expect(plywoodText(25, " in")).toBe("1 in");
  });
});

describe("lumber stock text", () => {
  it("names stock sections", () => {
    expect(lumberText([19, 89], "cleat")).toBe("1x4");
    expect(lumberText([89, 140], "skid")).toBe("4x6");
  });

  it("shows blocking cut to the gap as its size and the stock it comes from", () => {
    // 50 mm gap × 89 mm block: ripped from a 4x4.
    expect(lumberText([50, 89], "blocking")).toBe("1 15/16″ × 3 1/2″ from 4x4");
    expect(lumberText([25, 89], "bearer")).toBe("1″ × 3 1/2″ from 2x4");
    expect(lumberText([50, 60], "blocking", " in")).toBe("1 15/16 in x 2 3/8 in from 4x4");
    // A gap that happens to be stock is just its name.
    expect(lumberText([38, 89], "blocking")).toBe("2x4");
    // Wider than any stock: only the size.
    expect(lumberText([300, 300], "blocking")).toBe("11 13/16″ × 11 13/16″");
  });

  it("falls back to fractional inches for sizes that aren't stock", () => {
    expect(lumberText([25, 100], "cleat")).toBe("1″ × 3 15/16″");
    expect(lumberText([25, 100], "cleat", " in")).toBe("1 in x 3 15/16 in");
  });

  it("formats a section for the Overview", () => {
    expect(sectionText(19, 89)).toBe("1x4");
    expect(sectionText(89, 89)).toBe("4x4");
    expect(sectionText(25, 100)).toBe("1″ × 3 15/16″");
  });
});
