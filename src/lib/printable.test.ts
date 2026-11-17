import { describe, expect, it } from "vitest";
import { APP } from "./appInfo";
import { getPart, parts as catalogParts } from "@/domain/catalog";
import { screwSchedule } from "@/domain/crate";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { parseDesignFile, serializeDesign } from "@/domain/designFile";
import { planShipment } from "@/domain/shipment";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { buildPrintable, printableFromDesignFile, stepOfMember, ASSEMBLY_STEPS, type PrintableDesign } from "./printable";
import { printHash, readPrintHash } from "./printLink";

const bracket = getPart("PART-001");
const NOW = "2026-11-16T12:00:00.000Z";

function printable(quantity: number, units: "imperial" | "metric" = "imperial", extra: Partial<typeof DEFAULT_SETTINGS> = {}): PrintableDesign {
  const settings = { ...DEFAULT_SETTINGS, quantity, ...extra };
  const plan = planShipment(bracket, settings, null, DEFAULT_STANDARDS);
  return buildPrintable({ part: bracket, plan, standards: DEFAULT_STANDARDS, units, ranking: "volume", generatedAt: NOW });
}

describe("PrintableDesign (#26)", () => {
  const doc = printable(4);
  const [crate] = doc.crates;

  it("has the spec, build sheet and label for one crate", () => {
    expect(doc.problem).toBeNull();
    expect(doc.shipment.split).toBe(false);
    expect(doc.shipment.text).toBeNull();
    expect(doc.crates).toHaveLength(1);
    expect(doc.title).toBe("Crate for 4 × Machined steel bracket");
    expect(crate.spec.rows.map((r) => r.label)).toEqual(["Parts in the crate", "Outside (L × W × H)", "Gross", "Tare (empty crate)", "Payload", "Volume"]);
    expect(crate.spec.rows[1].value).toBe("36.7 × 25.7 × 19.6 in");
    expect(crate.spec.rows[1].note).toBe("932 × 652 × 497 mm");
    expect(crate.build.drawings.map((d) => d.id)).toEqual(["top", "front", "end", "section-plan", "section-side"]);
    expect(crate.label.partId).toBe("PART-001");
    expect(crate.label.quantity).toBe("4 PCS");
  });

  it("lists the part, freight terms and units in imperial", () => {
    expect(doc.part.find((r) => r.label === "Mass each")?.value).toBe("47.4 lb");
    const freight = Object.fromEntries(crate.spec.freight.map((r) => [r.label, r.value]));
    // The design's own freight terms (#17): 37 × 26 × 20 in ÷ 139 → 139 lb, class 65.
    expect(freight["Dimensional weight"]).toBe("139 lb");
    expect(freight["Density"]).toBe("26.7 lb/ft³");
    expect(freight["Freight class"]).toBe("65");
    expect(crate.label.gross).toMatch(/^\d+ LB$/);
  });

  it("follows metric units, keeping density in lb/ft³", () => {
    const m = printable(4, "metric");
    expect(m.crates[0].spec.rows[1].value).toBe("932 × 652 × 497 mm");
    const freight = Object.fromEntries(m.crates[0].spec.freight.map((r) => [r.label, r]));
    expect(freight["Dimensional weight"].value).toMatch(/^\d+ kg$/);
    expect(freight["Density"].value).toMatch(/lb\/ft³$/);
    expect(freight["Density"].note).toMatch(/kg\/m³$/);
    expect(m.crates[0].label.gross).toMatch(/^\d+ KG$/);
    expect(m.crates[0].build.cutList.some((g) => g.stock === "19 × 89 lumber")).toBe(true);
  });

  it("shows the design's freight class (#17), and a centre of gravity when it has one (#8)", () => {
    const settings = { ...DEFAULT_SETTINGS, quantity: 4 };
    const plan = planShipment(bracket, settings);
    const d = plan.crates[0].result.design!;
    // The design's own CoG, on the end view from the outside bottom-left corner.
    const { panelMm, cleat, floorMm, skid } = d.construction;
    expect(crate.label.views[0].cog.y).toBeCloseTo(d.handling.cogMm[1] + panelMm + cleat.thick, 6);
    expect(crate.label.views[0].cog.z).toBeCloseTo(d.handling.cogMm[2] + floorMm + skid.tall, 6);
    expect(crate.label.views[0].cog.y).toBeCloseTo(d.layout.external[1] / 2, 6);
    Object.assign(d, { freight: { ...d.freight, freightClass: 85 }, handling: { ...d.handling, cogMm: [400, 300, 150] } });
    const withExtras = buildPrintable({ part: bracket, plan, standards: DEFAULT_STANDARDS, units: "imperial", ranking: "volume", generatedAt: NOW });
    expect(withExtras.crates[0].spec.freight.find((r) => r.label === "Freight class")?.value).toBe("85");
    expect(withExtras.crates[0].label.views[0].cog.y).toBeCloseTo(300 - Math.min(...d.members.map((m) => m.min[1])), 6);
  });

  it("explains the chosen layout and names the runner-up", () => {
    expect(crate.spec.layout.chosen).toMatch(/^2 × 2, one layer/);
    expect(crate.spec.layout.why).toMatch(/recommended layout/);
    expect(crate.spec.layout.runnerUp).toMatch(/more volume|same volume/);
  });

  it("lists every check, cautions first, with pass / caution / info", () => {
    const ids = crate.spec.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["door", "stable", "blocking", "base-rating"]));
    expect(crate.spec.checks.find((c) => c.id === "door")?.levelText).toBe("Pass");
    const caution = printable(4, "imperial", { partGapMm: 10 });
    expect(caution.crates[0].spec.checks[0]).toMatchObject({ id: "blocking", levelText: "Caution" });
  });

  it("groups the cut list by stock with totals that match the cut list", () => {
    const groups = crate.build.cutList;
    expect(groups.map((g) => g.stock)).toEqual(expect.arrayContaining(["3/4″ plywood", "1/2″ plywood", "4x4", "1x4"]));
    // Each stock appears once; every cut-list piece is in exactly one group.
    expect(new Set(groups.map((g) => g.stock)).size).toBe(groups.length);
    const design = planShipment(bracket, { ...DEFAULT_SETTINGS, quantity: 4 }).crates[0].result.design!;
    const pieces = groups.reduce((n, g) => n + g.pieces, 0);
    expect(pieces).toBe(design.bom.reduce((n, l) => n + l.qty, 0));
    for (const g of groups) expect(g.pieces).toBe(g.lines.reduce((n, l) => n + l.qty, 0));
    expect(groups.find((g) => g.stock === "4x4")?.total).toMatch(/^\d+ ft$/);
    expect(groups.find((g) => g.stock === "1/2″ plywood")?.total).toMatch(/^\d+ ft²$/);
    expect(crate.build.totals.find((r) => r.label === "Wood screws")?.value).toBe(`~${design.screws}`);
  });

  it("has a fastener schedule that adds up to the screw estimate", () => {
    const design = planShipment(bracket, { ...DEFAULT_SETTINGS, quantity: 4 }).crates[0].result.design!;
    expect(crate.build.fastenerTotal).toBe(design.screws);
    expect(crate.build.fasteners.reduce((n, f) => n + f.qty, 0)).toBe(design.screws);
    expect(crate.build.fasteners.map((f) => f.title)).toEqual(expect.arrayContaining(["Floor to skids", "Blocking posts", "Lid to walls"]));
    // Spacings follow the units: 300 mm is 11 13/16″.
    expect(crate.build.fasteners.find((f) => f.title === "Floor to skids")?.rule).toBe("1 every 11 13/16″ along each skid, plus 1");
    const sum = screwSchedule(design.members, design.layout.interior).reduce((n, l) => n + l.qty, 0);
    expect(sum).toBe(design.screws);
  });

  it("orders assembly base → walls → load parts → blocking and separators → lid", () => {
    expect(crate.build.steps.map((s) => s.title)).toEqual([...ASSEMBLY_STEPS]);
    expect(crate.build.steps.map((s) => s.title)).toEqual(["Base", "Walls", "Load the parts", "Blocking and separators", "Lid"]);
    expect(crate.build.steps.reduce((n, s) => n + s.screws, 0)).toBe(crate.build.fastenerTotal);
    expect(crate.build.steps[0].pieces.map((p) => p.piece)).toEqual(expect.arrayContaining(["Floor", "Skid"]));
    expect(crate.build.steps[3].pieces.some((p) => p.piece === "Blocking post")).toBe(true);
    expect(crate.build.steps[4].pieces.some((p) => p.piece === "Lid panel")).toBe(true);
    // Every cut-list piece is placed by exactly one step.
    const design = planShipment(bracket, { ...DEFAULT_SETTINGS, quantity: 4 }).crates[0].result.design!;
    expect(crate.build.steps.reduce((n, s) => n + s.pieces.reduce((m, p) => m + p.qty, 0), 0)).toBe(design.bom.reduce((n, l) => n + l.qty, 0));
  });

  it("mentions layer separators when the parts are stacked", () => {
    const stacked = printable(8);
    const step = stacked.crates[0].build.steps[3];
    expect(step.pieces.some((p) => p.piece === "Layer separator")).toBe(true);
    expect(step.text).toMatch(/separator/);
  });

  it("draws the views from the members, dimensioned", () => {
    const design = planShipment(bracket, { ...DEFAULT_SETTINGS, quantity: 4 }).crates[0].result.design!;
    const [L, W, H] = design.layout.external;
    const top = crate.build.drawings.find((d) => d.id === "top")!;
    expect(top.width).toBeCloseTo(L, 3);
    expect(top.height).toBeCloseTo(W, 3);
    const front = crate.build.drawings.find((d) => d.id === "front")!;
    expect(front.height).toBeCloseTo(H, 3);
    expect(front.dims.map((d) => d.text)).toEqual(["36 11/16″", "19 9/16″"]);
    const plan = crate.build.drawings.find((d) => d.id === "section-plan")!;
    expect(plan.rects.filter((r) => r.kind === "part")).toHaveLength(4);
    expect(plan.rects.filter((r) => r.kind === "dunnage").length).toBeGreaterThan(0);
    const side = crate.build.drawings.find((d) => d.id === "section-side")!;
    expect(side.rects.some((r) => r.kind === "part")).toBe(true);
  });

  it("gives the label fork entry at the skid ends", () => {
    const [end] = crate.label.views;
    expect(crate.label.views).toHaveLength(1);
    expect(end.name).toBe("End");
    expect(end.feet.length).toBe(planShipment(bracket, { ...DEFAULT_SETTINGS, quantity: 4 }).crates[0].result.design!.construction.skidCount);
    expect(crate.label.forkEntry).toBe("Fork entry from the ends");
    // The arrows go in the openings the handling checks measured (#8): between the two skids.
    const [a, b] = end.feet;
    expect(end.openings).toHaveLength(1);
    expect(end.openings[0].y).toBeCloseTo(a.y + a.w, 6);
    expect(end.openings[0].y + end.openings[0].w).toBeCloseTo(b.y, 6);
    // The skids stand on the ground, and the arrows point to the middle of their height.
    expect(end.feet.every((f) => f.z === 0)).toBe(true);
    expect(end.baseMm).toBe(a.h);
    expect(end.tipMm).toBe(a.h / 2);
  });
});

describe("split shipments (#25) in the PrintableDesign", () => {
  const doc = printable(200);

  it("states the plan and has one spec, build sheet and label per crate type", () => {
    expect(doc.shipment.split).toBe(true);
    expect(doc.shipment.text).toMatch(/^Ships as \d+ × crate A \(\d+ each\) \+ 1 × crate B \(\d+\)$/);
    expect(doc.crates.map((c) => c.letter)).toEqual(["A", "B"]);
    const parts = doc.crates.reduce((n, c) => n + c.count * c.quantity, 0);
    expect(parts).toBe(200);
    for (const c of doc.crates) {
      expect(c.heading).toMatch(new RegExp(`^Crate ${c.letter}: ${c.quantity} × Machined steel bracket`));
      expect(c.build.steps).toHaveLength(5);
      expect(c.label.crate).toMatch(new RegExp(`^CRATE ${c.letter}`));
      expect(c.spec.checks.some((k) => k.id === "crate-limit")).toBe(true);
    }
    expect(doc.shipment.rows.find((r) => r.label === "Crates")?.value).toBe(String(doc.crates.reduce((n, c) => n + c.count, 0)));
  });
});

describe("the print link", () => {
  const settings = { ...DEFAULT_SETTINGS, quantity: 4 };
  const plan = planShipment(bracket, settings);
  const design = plan.crates[0].result.design!;
  const text = serializeDesign({
    app: APP,
    part: { source: "catalog", ...bracket, model: bracket.model },
    settings,
    layoutKey: design.layout.key,
    design,
    plan,
    savedAt: NOW,
  });

  // The link carries the file without its pretty-printing: same JSON, fewer characters.
  const compact = JSON.stringify(JSON.parse(text));

  it("round-trips the design file and the units through the hash, URL-safe", () => {
    const hash = printHash(text, "metric", true);
    expect(hash).toMatch(/^#design=[A-Za-z0-9_-]+&u=metric&print=1$/);
    expect(readPrintHash(hash)).toEqual({ ok: true, text: compact, units: "metric", print: true });
    expect(compact.length).toBeLessThan(text.length);
    expect(readPrintHash(printHash(text, "imperial"))).toMatchObject({ units: "imperial", print: false });
  });

  it("refuses a missing or broken hash, and reads unknown units as none", () => {
    expect(readPrintHash("")).toMatchObject({ ok: false });
    expect(readPrintHash("#design=%%%")).toMatchObject({ ok: false });
    expect(readPrintHash(printHash(text, "imperial").replace("&u=imperial", "&u=furlongs"))).toMatchObject({ ok: true, units: null });
  });

  it("uses the share link's `design` parameter, and still opens old `d` links (#62)", () => {
    const data = printHash(text, "imperial").slice("#design=".length).split("&")[0];
    expect(printHash(text, "imperial").startsWith("#design=")).toBe(true);
    expect(readPrintHash(`#design=${data}&u=imperial`)).toEqual({ ok: true, text: compact, units: "imperial", print: false });
    expect(readPrintHash(`#d=${data}&u=metric&print=1`)).toEqual({ ok: true, text: compact, units: "metric", print: true });
    expect(readPrintHash("#d=%%%")).toMatchObject({ ok: false });
    // A padded or truncated value is refused like a damaged share link, not half-read.
    expect(readPrintHash("#design=abc=")).toMatchObject({ ok: false });
    expect(readPrintHash("#design=a")).toMatchObject({ ok: false });
  });

  it("rebuilds the same document from the design file", () => {
    const file = parseDesignFile(text);
    expect(file.ok).toBe(true);
    const r = printableFromDesignFile(text, DEFAULT_STANDARDS, "imperial", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes).toEqual([]);
    expect(r.doc).toEqual(printable(4));
    expect(printableFromDesignFile("{", DEFAULT_STANDARDS, "imperial", NOW)).toMatchObject({ ok: false });
  });
});

describe("cradles (#6) in the build sheet", () => {
  const shaft = getPart("PART-002");
  const build = (quantity: number) => {
    const plan = planShipment(shaft, { ...DEFAULT_SETTINGS, quantity }, null, DEFAULT_STANDARDS);
    return {
      doc: buildPrintable({ part: shaft, plan, standards: DEFAULT_STANDARDS, units: "metric", ranking: "volume", generatedAt: NOW }),
      design: plan.crates[0].result.design!,
    };
  };

  it("places floor cradles before the parts and stacking cradles and end stops after", () => {
    const { doc, design } = build(4);
    const steps = doc.crates[0].build.steps;
    expect(steps[2].pieces.map((p) => p.piece)).toContain("Cradle");
    expect(steps[2].text).toMatch(/Screw the 4 notched cradles to the floor .* 4 along each part/);
    expect(steps[2].text).toContain("Cut each notch as a round seat of 86 mm radius, 43 mm deep and 149 mm across");
    expect(steps[3].pieces.map((p) => p.piece)).toEqual(expect.arrayContaining(["Stacking cradle", "End stop"]));
    expect(steps[3].text).toMatch(/stacking cradle/);
    expect(steps.reduce((n, s) => n + s.pieces.reduce((m, p) => m + p.qty, 0), 0)).toBe(design.bom.reduce((n, l) => n + l.qty, 0));
    expect(steps.reduce((n, s) => n + s.screws, 0)).toBe(design.screws);
    expect(doc.crates[0].build.fasteners.map((f) => f.title)).toEqual(
      expect.arrayContaining(["Cradles to floor", "Stacking cradles through the side walls", "End stops"]),
    );
  });

  it("shows the cradles in Section A–A and Section B–B, cut down through the notch", () => {
    const { doc, design } = build(1);
    const drawings = doc.crates[0].build.drawings;
    const plan = drawings.find((d) => d.id === "section-plan")!;
    expect(plan.title).toMatch(/cradles/);
    const cradles = design.members.filter((m) => m.kind === "cradle");
    for (const m of cradles) expect(plan.rects.some((r) => r.kind === "dunnage" && r.x === m.min[0] && r.w === m.size[0] && r.h === m.size[1])).toBe(true);
    const side = drawings.find((d) => d.id === "section-side")!;
    expect(side.title).toMatch(/cradles/);
    const slot = design.layout.slots[0];
    for (const m of cradles) {
      const r = side.rects.find((x) => x.kind === "dunnage" && x.x === m.min[0] && x.w === m.size[0])!;
      expect(r.y).toBe(0);
      expect(r.h).toBeCloseTo(slot.min[2]); // the part rests on the notch bottom
    }
  });

  it("keeps the general blocking titles for other parts", () => {
    const plan = printable(4).crates[0].build.drawings.find((d) => d.id === "section-plan")!;
    expect(plan.title).toBe("Section A–A: plan through the bottom layer, showing the blocking");
  });
});

describe("assembly steps", () => {
  it("puts every member of every catalog design in a step, and every step has its pieces", () => {
    for (const part of catalogParts) {
      for (const quantity of [1, part.suggested_quantities[1] ?? 4, 12]) {
        for (const maxLayers of [1, 2]) {
          const plan = planShipment(part, { ...DEFAULT_SETTINGS, quantity, maxLayers }, null, DEFAULT_STANDARDS);
          const design = plan.crates[0].result.design!;
          for (const m of design.members) {
            expect(stepOfMember(m), `${part.id} x${quantity}: ${m.label}`).toBeGreaterThanOrEqual(0);
            expect(stepOfMember(m)).toBeLessThan(ASSEMBLY_STEPS.length);
          }
          const doc = buildPrintable({ part, plan, standards: DEFAULT_STANDARDS, units: "metric", ranking: "volume", generatedAt: NOW });
          const placed = doc.crates[0].build.steps.reduce((n, s) => n + s.pieces.reduce((k, p) => k + p.qty, 0), 0);
          expect(placed, `${part.id} x${quantity}`).toBe(design.members.length);
          expect(doc.crates[0].build.steps.reduce((n, s) => n + s.screws, 0)).toBe(design.screws);
        }
      }
    }
  });

  it("orders bearers and floor cradles before the parts, blocking and stacking cradles after", () => {
    const at = (kind: "bearer" | "blocking" | "cradle" | "separator", variant?: "shaped-block" | "stacking-cradle") =>
      stepOfMember({ assembly: "inside", kind, variant });
    expect(at("bearer")).toBe(2);
    expect(at("cradle")).toBe(2);
    expect(at("cradle", "stacking-cradle")).toBe(3);
    expect(at("blocking")).toBe(3);
    expect(at("blocking", "shaped-block")).toBe(3);
    expect(at("separator")).toBe(3);
  });
});

describe("the document date", () => {
  it("is the date on the clock where it was made, in the print and the header", () => {
    const late = "2026-11-17T07:16:00.000Z";
    const plan = planShipment(bracket, { ...DEFAULT_SETTINGS, quantity: 4 }, null, DEFAULT_STANDARDS);
    const make = (timeZone: string) =>
      buildPrintable({ part: bracket, plan, standards: DEFAULT_STANDARDS, units: "imperial", ranking: "volume", generatedAt: late, timeZone });
    expect(make("America/Los_Angeles").date).toBe("2026-11-16");
    expect(make("UTC").date).toBe("2026-11-17");
  });
});
