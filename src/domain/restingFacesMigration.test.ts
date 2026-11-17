import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { DESIGN_SCHEMA_VERSION, parseDesignFile, serializeDesign, type DesignFilePart } from "./designFile";
import { ANY_FACES, AS_MODELLED_FACES } from "./orientations";
import { CrateSettingsSchema } from "./schema";
import { base64UrlEncode, readShareHash } from "./shareLink";
import { TEST_APP } from "./testFixtures";

/** Settings saved before the allowed resting faces (#109): `keepUpright` instead of `restingFaces`. */
const OLD = { quantity: 4, maxLayers: 2, partGapMm: 50, wallClearanceMm: 50, panelThickness: "auto" } as const;

describe("settings from before resting faces (#109)", () => {
  it("reads keepUpright true as as modelled and false as any face", () => {
    expect(CrateSettingsSchema.parse({ ...OLD, keepUpright: true }).restingFaces).toEqual(AS_MODELLED_FACES);
    expect(CrateSettingsSchema.parse({ ...OLD, keepUpright: false }).restingFaces).toEqual(ANY_FACES);
  });

  it("leaves keepUpright out of what it returns", () => {
    expect(CrateSettingsSchema.parse({ ...OLD, keepUpright: false })).not.toHaveProperty("keepUpright");
  });

  it("a caller that sends neither gets the old default, as modelled", () => {
    expect(CrateSettingsSchema.parse(OLD).restingFaces).toEqual(AS_MODELLED_FACES);
  });

  it("restingFaces wins when both are sent, and a list out of order or repeated is put in order", () => {
    expect(CrateSettingsSchema.parse({ ...OLD, keepUpright: true, restingFaces: ["-y"] }).restingFaces).toEqual(["-y"]);
    expect(CrateSettingsSchema.parse({ ...OLD, restingFaces: ["+x", "-z", "+x"] }).restingFaces).toEqual(["-z", "+x"]);
  });

  it("refuses an empty list, an unknown face and a keepUpright that is not a boolean", () => {
    for (const bad of [{ restingFaces: [] }, { restingFaces: ["up"] }, { restingFaces: "any" }, { keepUpright: "yes" }]) {
      expect(CrateSettingsSchema.safeParse({ ...OLD, ...bad }).success).toBe(false);
    }
  });
});

describe("a design file saved as format 3, with keepUpright", () => {
  const p = getPart("PART-002");
  const part: DesignFilePart = {
    source: "catalog",
    id: p.id,
    name: p.name,
    material: p.material,
    mass_kg: p.mass_kg,
    dimensions_mm: p.dimensions_mm,
    model: p.model,
    units: "m",
    up: "z",
  };

  /** What a format 3 build wrote: the current file with `keepUpright` in place of `restingFaces`. */
  const asFormat3 = (keepUpright: boolean) => {
    const settings = { ...DEFAULT_SETTINGS, quantity: 2, restingFaces: keepUpright ? AS_MODELLED_FACES : ANY_FACES };
    const design = computeDesign(p, settings).design!;
    const doc = JSON.parse(serializeDesign({ app: TEST_APP, part, settings, layoutKey: design.layout.key, design, savedAt: "2026-11-16T12:00:00.000Z" }));
    doc.schemaVersion = 3;
    delete doc.settings.restingFaces;
    doc.settings.keepUpright = keepUpright;
    return doc;
  };

  it("is format 4 now", () => {
    expect(DESIGN_SCHEMA_VERSION).toBe(4);
  });

  it.each([
    [true, AS_MODELLED_FACES],
    [false, ANY_FACES],
  ])("opens with keepUpright %s as the faces %j", (keepUpright, faces) => {
    const r = parseDesignFile(JSON.stringify(asFormat3(keepUpright)));
    if (!r.ok) throw new Error(r.error);
    expect(r.file.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(r.file.settings.restingFaces).toEqual(faces);
    expect(r.file.settings).not.toHaveProperty("keepUpright");
  });

  it("opens through a share link too, and keeps the saved layout", () => {
    const doc = asFormat3(false);
    const r = readShareHash(`#design=${base64UrlEncode(JSON.stringify(doc))}`);
    if (!r?.ok) throw new Error("the link did not open");
    expect(r.file.settings.restingFaces).toEqual(ANY_FACES);
    expect(r.file.layoutKey).toBe(doc.layoutKey);
  });

  it("a format 1 file (with keepUpright) goes through every migration", () => {
    const doc = asFormat3(true);
    doc.schemaVersion = 1;
    delete doc.ranking;
    delete doc.part.units;
    delete doc.part.up;
    const r = parseDesignFile(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.error);
    expect(r.file.settings.restingFaces).toEqual(AS_MODELLED_FACES);
  });

  it("writing what was read gives a format 4 file with the faces, and no keepUpright", () => {
    const r = parseDesignFile(JSON.stringify(asFormat3(false)));
    if (!r.ok) throw new Error(r.error);
    const design = computeDesign(p, r.file.settings).design!;
    const text = serializeDesign({
      app: TEST_APP,
      part: r.file.part,
      settings: r.file.settings,
      layoutKey: design.layout.key,
      design,
      savedAt: r.file.savedAt,
    });
    const json = JSON.parse(text);
    expect(json.settings.restingFaces).toEqual([...ANY_FACES]);
    expect(json.settings).not.toHaveProperty("keepUpright");
  });
});
