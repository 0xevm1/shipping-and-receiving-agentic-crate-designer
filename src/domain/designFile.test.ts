import { ANY_FACES } from "./orientations";
import { describe, expect, it } from "vitest";
import { parts } from "./catalog";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import {
  DESIGN_FILE_KIND,
  DESIGN_SCHEMA_VERSION,
  isDesignFileJson,
  parseDesignFile,
  restoreDesign,
  serializeDesign,
  type DesignFile,
  type DesignFilePart,
} from "./designFile";
import type { CrateSettings } from "./schema";
import { planShipment } from "./shipment";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards } from "./standards";
import { metricText, TEST_APP, facesFor } from "./testFixtures";

const SAVED_AT = "2026-11-16T12:00:00.000Z";

function catalogFilePart(id: string): DesignFilePart {
  const p = parts.find((x) => x.id === id)!;
  return {
    source: "catalog",
    id: p.id,
    name: p.name,
    material: p.material,
    mass_kg: p.mass_kg,
    dimensions_mm: p.dimensions_mm,
    model: p.model,
  };
}

const widget: DesignFilePart = {
  source: "custom",
  id: "widget_v2",
  name: "Gear housing",
  material: "6061-T6 aluminum",
  mass_kg: 12.5,
  dimensions_mm: [412.3, 288.1, 140.6],
  model: "widget_v2.glb",
};

function save(part: DesignFilePart, settings: CrateSettings, layoutKey?: string | null) {
  const result = computeDesign(part, settings, layoutKey);
  const text = serializeDesign({ app: TEST_APP, part, settings, layoutKey: result.design!.layout.key, design: result.design!, savedAt: SAVED_AT });
  return { text, result };
}

describe("serializeDesign", () => {
  it("writes a versioned file with the part, settings, layout and a summary", () => {
    const part = catalogFilePart("PART-001");
    const { text, result } = save(part, DEFAULT_SETTINGS);
    const json = JSON.parse(text);
    expect(json.kind).toBe(DESIGN_FILE_KIND);
    expect(json.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(json.app).toEqual({ name: "crate-designer", version: TEST_APP.version });
    expect(json.savedAt).toBe(SAVED_AT);
    expect(json.part).toEqual(part);
    expect(json.settings).toEqual(DEFAULT_SETTINGS);
    expect(json.layoutKey).toBe(result.design!.layout.key);
    expect(json.summary).toEqual({
      quantity: 4,
      layout: "2 × 2 × 1, As modeled",
      outsideMm: [932, 652, 497],
      grossKg: Math.round(result.design!.grossKg * 10) / 10,
    });
  });

  it("is readable: pretty-printed, ending in a newline", () => {
    const { text } = save(catalogFilePart("PART-001"), DEFAULT_SETTINGS);
    expect(text).toContain('\n  "kind": "crate-design"');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("round-trips through parseDesignFile", () => {
    const { text } = save(widget, { ...DEFAULT_SETTINGS, quantity: 6, restingFaces: ANY_FACES, panelThickness: 15 });
    const r = parseDesignFile(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeDesign(fromFile(r.file))).toBe(text);
  });

  it("keeps the stand-in flag for a custom part without a real mass", () => {
    const { text } = save({ ...widget, mass_kg: 10, massAssumed: true }, DEFAULT_SETTINGS);
    const r = parseDesignFile(text);
    expect(r.ok && r.file.part.massAssumed).toBe(true);
  });
});

function fromFile(f: DesignFile) {
  const design = computeDesign(f.part, f.settings, f.layoutKey).design!;
  return { part: f.part, settings: f.settings, layoutKey: f.layoutKey, ranking: f.ranking, design, app: f.app, savedAt: f.savedAt };
}

describe("isDesignFileJson", () => {
  it("tells a design file from a parts.json catalog", () => {
    expect(isDesignFileJson({ kind: "crate-design" })).toBe(true);
    expect(isDesignFileJson({ schema_version: "1.0", parts: [] })).toBe(false);
    expect(isDesignFileJson(null)).toBe(false);
    expect(isDesignFileJson([1, 2])).toBe(false);
  });
});

describe("parseDesignFile", () => {
  const valid = () => JSON.parse(save(catalogFilePart("PART-002"), { ...DEFAULT_SETTINGS, quantity: 2 }).text);

  it("rejects text that is not JSON", () => {
    expect(parseDesignFile("{nope")).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/) });
  });

  it("rejects JSON that is not a design file", () => {
    expect(parseDesignFile(JSON.stringify({ parts: [] }))).toEqual({ ok: false, error: expect.stringMatching(/not a crate design/) });
  });

  it("rejects a design saved by a newer app", () => {
    const r = parseDesignFile(JSON.stringify({ ...valid(), schemaVersion: DESIGN_SCHEMA_VERSION + 1 }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/newer version/) });
  });

  it("rejects a missing or unknown version", () => {
    const noVersion = valid();
    delete noVersion.schemaVersion;
    expect(parseDesignFile(JSON.stringify(noVersion)).ok).toBe(false);
    expect(parseDesignFile(JSON.stringify({ ...valid(), schemaVersion: 0 })).ok).toBe(false);
    expect(parseDesignFile(JSON.stringify({ ...valid(), schemaVersion: "1" })).ok).toBe(false);
  });

  it("names the field that is wrong", () => {
    const bad = valid();
    bad.part.mass_kg = -3;
    const r = parseDesignFile(JSON.stringify(bad));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/part\.mass_kg/) });
  });

  it("rejects settings outside the schema rather than guessing", () => {
    const bad = valid();
    bad.settings.quantity = 500;
    expect(parseDesignFile(JSON.stringify(bad)).ok).toBe(false);
    const nan = valid();
    nan.settings.panelThickness = 3;
    expect(parseDesignFile(JSON.stringify(nan)).ok).toBe(false);
  });

  it("rejects a model that is not a .glb and an unknown part source", () => {
    const a = valid();
    a.part.model = "bracket.gltf";
    expect(parseDesignFile(JSON.stringify(a)).ok).toBe(false);
    const b = valid();
    b.part.source = "cloud";
    expect(parseDesignFile(JSON.stringify(b)).ok).toBe(false);
  });

  it("ignores unknown extra keys, so later minor additions still open", () => {
    const r = parseDesignFile(JSON.stringify({ ...valid(), note: "for the March order" }));
    expect(r.ok).toBe(true);
    expect(r.ok && "note" in r.file).toBe(false);
  });
});

describe("restoreDesign", () => {
  it("reproduces the same outside size and cut list for every catalog part × suggested quantity", () => {
    for (const p of parts) {
      for (const quantity of p.suggested_quantities) {
        for (const keepUpright of [true, false]) {
          const settings = { ...DEFAULT_SETTINGS, quantity, restingFaces: facesFor(keepUpright) };
          const original = computeDesign(p, settings).design!;
          // Save the runner-up layout when there is one, so the pick matters.
          const layouts = computeDesign(p, settings).layouts;
          const pick = layouts[1] ?? layouts[0];
          const picked = computeDesign(p, settings, pick.key).design!;
          for (const design of [original, picked]) {
            const filePart = catalogFilePart(p.id);
            const text = serializeDesign({ app: TEST_APP, part: filePart, settings, layoutKey: design.layout.key, design, savedAt: SAVED_AT });
            const r = parseDesignFile(text);
            if (!r.ok) throw new Error(r.error);
            const restored = restoreDesign(r.file, p);
            expect(restored.notes).toEqual([]);
            expect(restored.layoutKey).toBe(design.layout.key);
            const again = computeDesign(p, restored.settings, restored.layoutKey).design!;
            expect(again.layout.external).toEqual(design.layout.external);
            expect(again.grossKg).toBeCloseTo(design.grossKg, 6);
            expect(again.bom).toEqual(design.bom);
          }
        }
      }
    }
  });

  it("reproduces a custom part's crate from the saved size and mass", () => {
    const settings = { ...DEFAULT_SETTINGS, quantity: 6, partGapMm: 30, maxLayers: 3 };
    const { text, result } = save(widget, settings);
    const r = parseDesignFile(text);
    if (!r.ok) throw new Error(r.error);
    const restored = restoreDesign(r.file, r.file.part);
    expect(restored.notes).toEqual([]);
    const again = computeDesign(r.file.part, restored.settings, restored.layoutKey).design!;
    expect(again.layout.external).toEqual(result.design!.layout.external);
    expect(again.bom).toEqual(result.design!.bom);
  });

  it("falls back to the recommended layout when the saved one no longer exists, and says so", () => {
    const { text } = save(catalogFilePart("PART-001"), DEFAULT_SETTINGS);
    const file = (parseDesignFile(text) as { ok: true; file: DesignFile }).file;
    const stale = { ...file, layoutKey: "u:1x1x1:999" };
    const restored = restoreDesign(stale, parts[0]);
    expect(restored.layoutKey).toBeNull();
    expect(restored.notes.map(metricText).join(" ")).toMatch(/saved layout .* recommended one/i);
  });

  it("says so when the crate comes out different from the saved summary", () => {
    const { text } = save(catalogFilePart("PART-001"), DEFAULT_SETTINGS);
    const file = (parseDesignFile(text) as { ok: true; file: DesignFile }).file;
    // The catalog entry changed since the design was saved: a heavier part.
    const heavier = { ...parts[0], mass_kg: parts[0].mass_kg * 2 };
    const restored = restoreDesign(file, heavier);
    expect(restored.notes.map(metricText).join(" ")).toMatch(/gross/i);
    const tampered = { ...file, summary: { ...file.summary, outsideMm: [1000, 652, 497] as [number, number, number] } };
    expect(restoreDesign(tampered, parts[0]).notes.map(metricText).join(" ")).toMatch(/932 mm × 652 mm × 497 mm.*1,000 mm × 652 mm × 497 mm/);
  });
});

describe("design file: a split batch (#25)", () => {
  const p = parts.find((x) => x.id === "PART-001")!;
  const settings = { ...DEFAULT_SETTINGS, quantity: 200 };

  function saveType(index: number, standards = DEFAULT_STANDARDS) {
    const plan = planShipment(p, settings, null, standards);
    const design = plan.crates[index].result.design!;
    return serializeDesign({ app: TEST_APP, part: catalogFilePart(p.id), settings, layoutKey: design.layout.key, design, plan, savedAt: SAVED_AT });
  }

  it("writes the crate types only for a split, so single-crate files are unchanged", () => {
    const json = JSON.parse(saveType(1));
    const plan = planShipment(p, settings);
    expect(json.summary.shipment).toEqual(plan.crates.map((c) => ({ count: c.count, quantity: c.quantity })));
    expect(json.summary.quantity).toBe(plan.crates[1].quantity);
    const one = planShipment(p, DEFAULT_SETTINGS);
    const text = serializeDesign({
      app: TEST_APP,
      part: catalogFilePart(p.id),
      settings: DEFAULT_SETTINGS,
      layoutKey: one.crates[0].result.design!.layout.key,
      design: one.crates[0].result.design!,
      plan: one,
      savedAt: SAVED_AT,
    });
    expect(JSON.parse(text).summary.shipment).toBeUndefined();
    expect(text).toBe(save(catalogFilePart(p.id), DEFAULT_SETTINGS).text);
  });

  it("re-opens to the same plan, showing the crate type that was saved", () => {
    for (const index of [0, 1]) {
      const r = parseDesignFile(saveType(index));
      if (!r.ok) throw new Error(r.error);
      const restored = restoreDesign(r.file, p);
      expect(restored.notes).toEqual([]);
      expect(restored.crateIndex).toBe(index);
      const plan = planShipment(p, restored.settings, restored.layoutKey);
      expect(plan.crates.map((c) => [c.count, c.quantity])).toEqual(r.file.summary.shipment!.map((c) => [c.count, c.quantity]));
    }
  });

  it("restores with the shop's standards, and says so when the plan comes out different", () => {
    const lower = parseStandards(mergeStandards(DEFAULT_STANDARDS, { limits: { perCrate: { maxGrossKg: 500 } } }));
    if (!lower.ok) throw new Error(lower.error);
    const r = parseDesignFile(saveType(0, lower.standards));
    if (!r.ok) throw new Error(r.error);
    expect(restoreDesign(r.file, p, lower.standards).notes).toEqual([]);
    const notes = restoreDesign(r.file, p).notes.map(metricText).join(" ");
    expect(notes).toMatch(/now ships as .*crate A.*\(was .*crate A/);
  });
});

describe("format 3: the part's file units and up axis (#105)", () => {
  const inchesYUp: DesignFilePart = { ...widget, units: "in", up: "y", unitsGuessed: true };

  /** A file as format 2 wrote it: the current file with the format 3 part fields taken out. */
  const asFormat2 = (part: DesignFilePart) => {
    const doc = JSON.parse(save(part, DEFAULT_SETTINGS).text);
    doc.schemaVersion = 2;
    delete doc.part.units;
    delete doc.part.up;
    delete doc.part.unitsGuessed;
    return doc;
  };

  it("saves the units, the axis and whether the units were a guess, and reads them back", () => {
    const { text } = save(inchesYUp, DEFAULT_SETTINGS);
    const json = JSON.parse(text);
    expect(json.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(json.part).toMatchObject({ units: "in", up: "y", unitsGuessed: true });
    const r = parseDesignFile(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.file.part).toMatchObject({ units: "in", up: "y", unitsGuessed: true });
    // Writing what was read gives the same file.
    const again = serializeDesign({
      app: TEST_APP,
      part: r.file.part,
      settings: r.file.settings,
      layoutKey: r.file.layoutKey,
      design: computeDesign(r.file.part, r.file.settings).design!,
      savedAt: SAVED_AT,
    });
    expect(again).toBe(text);
  });

  it("rejects units or an axis the app does not offer", () => {
    for (const bad of [{ units: "ft" }, { up: "x" }, { unitsGuessed: false }]) {
      const doc = JSON.parse(save(inchesYUp, DEFAULT_SETTINGS).text);
      Object.assign(doc.part, bad);
      expect(parseDesignFile(JSON.stringify(doc)).ok).toBe(false);
    }
  });

  it("migrates format 2: Z up, a catalog part in metres, a custom part's units left for the reader to find", () => {
    const custom = parseDesignFile(JSON.stringify(asFormat2(widget)));
    if (!custom.ok) throw new Error(custom.error);
    expect(custom.file.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(custom.file.part.up).toBe("z");
    expect(custom.file.part.units).toBeUndefined();
    const catalog = parseDesignFile(JSON.stringify(asFormat2(catalogFilePart("PART-001"))));
    if (!catalog.ok) throw new Error(catalog.error);
    expect(catalog.file.part).toMatchObject({ up: "z", units: "m" });
  });

  it("migrates format 1 through 2 to 3", () => {
    const doc = asFormat2(widget);
    doc.schemaVersion = 1;
    delete doc.ranking;
    const r = parseDesignFile(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.error);
    expect(r.file).toMatchObject({ schemaVersion: DESIGN_SCHEMA_VERSION, ranking: "volume", part: { up: "z" } });
  });

  it("keeps the rest of a migrated file as it was", () => {
    const doc = asFormat2(widget);
    const r = parseDesignFile(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.error);
    expect(r.file.settings).toEqual(doc.settings);
    expect(r.file.summary).toEqual(doc.summary);
    expect(r.file.part).toMatchObject({ id: "widget_v2", dimensions_mm: widget.dimensions_mm, model: "widget_v2.glb" });
  });

  it("keeps the engine's stamp (#46) of a format 2 file the engine wrote", () => {
    const engine = { version: "0.1.0+engine.3", inputHash: "f".repeat(64) };
    const r = parseDesignFile(JSON.stringify({ ...asFormat2(widget), engine }));
    if (!r.ok) throw new Error(r.error);
    expect(r.file).toMatchObject({ schemaVersion: DESIGN_SCHEMA_VERSION, engine });
  });
});
