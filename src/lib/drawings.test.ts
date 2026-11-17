import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { cradleSolidAt } from "@/domain/cradles";
import type { CrateDesign } from "@/domain/crate";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { planShipment } from "@/domain/shipment";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { crateDrawings } from "./drawings";
import { memberBounds } from "./memberBounds";

function design(id: string, quantity: number): CrateDesign {
  return planShipment(getPart(id), { ...DEFAULT_SETTINGS, quantity }, null, DEFAULT_STANDARDS).crates[0].result.design!;
}

const byId = (d: CrateDesign, units: "metric" | "imperial" = "metric") => Object.fromEntries(crateDrawings(d, units).map((x) => [x.id, x]));

describe("crateDrawings", () => {
  const bracket = design("PART-001", 4);
  const views = byId(bracket);

  it("gives three outside views and two sections, in print order", () => {
    expect(crateDrawings(bracket, "metric").map((d) => d.id)).toEqual(["top", "front", "end", "section-plan", "section-side"]);
    expect(views.top.section).toBe(false);
    expect(views["section-plan"].section).toBe(true);
  });

  it("draws the outside views as the crate's own size, with its dimension lines", () => {
    const [L, W, H] = memberBounds(bracket.members).max.map((v, i) => v - memberBounds(bracket.members).min[i]);
    expect([views.top.width, views.top.height]).toEqual([L, W]);
    expect([views.front.width, views.front.height]).toEqual([L, H]);
    expect([views.end.width, views.end.height]).toEqual([W, H]);
    expect(views.top.dims).toEqual([
      { side: "below", from: views.top.minX, to: views.top.minX + L, text: String(Math.round(L)) },
      { side: "right", from: views.top.minY, to: views.top.minY + W, text: String(Math.round(W)) },
    ]);
  });

  it("writes the dimension lines in fractional inches for imperial", () => {
    const imperial = byId(bracket, "imperial");
    expect(imperial.top.dims[0].text).toMatch(/″$/);
  });

  it("paints every board of an outside view, far to near", () => {
    expect(views.top.rects).toHaveLength(bracket.members.length);
    const dunnage = views.top.rects.filter((r) => r.kind === "dunnage").length;
    expect(dunnage).toBe(bracket.members.filter((m) => ["blocking", "bearer", "cradle"].includes(m.kind)).length);
  });

  it("puts one dashed part per bottom-layer slot in each section, inside the crate interior", () => {
    const bottom = bracket.layout.slots.filter((s) => s.index[2] === 0).length;
    expect(views["section-plan"].rects.filter((r) => r.kind === "part")).toHaveLength(bottom);
    const row = bracket.layout.slots.filter((s) => s.index[1] === 0).length;
    expect(views["section-side"].rects.filter((r) => r.kind === "part")).toHaveLength(row);
    const [L, , H] = bracket.layout.interior;
    expect(views["section-plan"].dims[0]).toMatchObject({ side: "below", from: 0, to: L });
    expect(views["section-side"].dims[1]).toMatchObject({ side: "right", from: 0, to: H });
  });
});

describe("crateDrawings with cradles", () => {
  const shaft = design("PART-002", 4);
  const cradles = shaft.members.filter((m) => m.kind === "cradle");
  const views = byId(shaft);

  it("has cradles to draw, and says so in the section titles", () => {
    expect(cradles.length).toBeGreaterThan(0);
    expect(views["section-plan"].title).toMatch(/cradles and end stops/);
    expect(views["section-side"].title).toMatch(/cradles, stacking cradles and end stops/);
  });

  it("draws each floor cradle in the plan section as seen beneath the cut", () => {
    const cutZ = shaft.layout.slots.filter((s) => s.index[2] === 0)[0].min[2] + shaft.layout.cellSize[2] / 2;
    const below = cradles.filter((m) => m.min[2] + m.size[2] <= cutZ);
    expect(below.length).toBeGreaterThan(0);
    for (const m of below) {
      expect(
        views["section-plan"].rects.some((r) => r.kind === "dunnage" && r.x === m.min[0] && r.y === m.min[1] && r.w === m.size[0] && r.h === m.size[1]),
      ).toBe(true);
    }
  });

  it("cuts a cradle through its notch in the side section: only the solid part shows", () => {
    const cutY = shaft.layout.slots.filter((s) => s.index[1] === 0)[0].min[1] + shaft.layout.cellSize[1] / 2;
    const side = views["section-side"].rects.filter((r) => r.kind === "dunnage");
    for (const m of cradles) {
      if (!(m.min[1] < cutY && cutY < m.min[1] + m.size[1])) continue;
      const [z0, z1] = cradleSolidAt(m, cutY);
      expect(side.some((r) => r.x === m.min[0] && r.w === m.size[0] && r.y === z0 && r.h === z1 - z0)).toBe(true);
    }
  });
});

describe("crateDrawings with bearers", () => {
  it("draws bearers that sit off the cut as seen beyond it, and every dunnage kind as dunnage", () => {
    const d = design("PART-001", 8);
    const bearers = d.members.filter((m) => m.kind === "bearer");
    const side = byId(d)["section-side"];
    if (bearers.length) expect(side.rects.some((r) => r.kind === "dunnage")).toBe(true);
    for (const r of side.rects) expect(["plywood", "lumber", "dunnage", "part"]).toContain(r.kind);
  });
});
