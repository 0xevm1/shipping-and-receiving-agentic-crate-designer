import { readFileSync } from "node:fs";
import { APP } from "./appInfo";
import { describe, expect, it } from "vitest";
import { getPart, parts } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { serializeDesign } from "@/domain/designFile";
import { designFilePart, idFromFile, loadPartFiles, nameFromFile } from "./loadPart";
import { catalogPart, type LoadedPart } from "./part";

describe("file helpers", () => {
  it("names a part from its file", () => {
    expect(nameFromFile("PART-004-cast-iron-cover.glb")).toBe("Cast iron cover");
    expect(nameFromFile("widget_v2.glb")).toBe("Widget v2");
  });

  it("never gives a part an empty id or name, even from a file called only .glb", () => {
    expect(idFromFile(".glb")).toBe("part");
    expect(nameFromFile(".glb")).toBe("Part");
    expect(idFromFile("widget_v2.GLB")).toBe("widget_v2");
    const file = serializeDesign({
      app: APP,
      part: { ...designFilePart(catalogPart(getPart("PART-001"))), source: "custom", id: idFromFile(".glb"), name: nameFromFile(".glb"), model: ".glb" },
      settings: DEFAULT_SETTINGS,
      layoutKey: computeDesign(catalogPart(getPart("PART-001")), DEFAULT_SETTINGS).design!.layout.key,
      design: computeDesign(catalogPart(getPart("PART-001")), DEFAULT_SETTINGS).design!,
      savedAt: "2026-11-16T00:00:00Z",
    });
    expect(JSON.parse(file).part).toMatchObject({ id: "part", name: "Part", model: ".glb" });
  });
});

describe("design files (#28)", () => {
  const settings = { ...DEFAULT_SETTINGS, quantity: 8, maxLayers: 3 };
  const designJson = (part: LoadedPart) => {
    const design = computeDesign(part, settings).design!;
    return serializeDesign({ app: APP, part: designFilePart(part), settings, layoutKey: design.layout.key, design, savedAt: "2026-11-16T00:00:00Z" });
  };
  const jsonFile = (text: string, name = "design.json") => new File([text], name, { type: "application/json" });
  const shaft = catalogPart(parts.find((p) => p.id === "PART-002")!);
  const custom: LoadedPart = {
    ...shaft,
    id: "widget_v2",
    name: "Widget",
    model: "widget_v2.glb",
    modelUrl: "blob:x",
    catalogDims: undefined,
  };

  it("marks bundled catalog parts as catalog and anything else as custom", () => {
    expect(designFilePart(shaft)).toMatchObject({ source: "catalog", id: "PART-002", model: "PART-002-long-steel-shaft.glb" });
    // The bundled model loaded from disk is still the catalog part.
    expect(designFilePart({ ...shaft, modelUrl: "blob:y" }).source).toBe("catalog");
    expect(designFilePart(custom)).toMatchObject({ source: "custom", model: "widget_v2.glb" });
    expect(designFilePart({ ...custom, massAssumed: true }).massAssumed).toBe(true);
  });

  it("restores a catalog design from the bundled catalog with its rules and layout", async () => {
    const out = await loadPartFiles([jsonFile(designJson(shaft))], parts);
    expect(out.part).toMatchObject({ id: "PART-002", modelUrl: "/parts/PART-002-long-steel-shaft.glb" });
    expect(out.design?.settings).toEqual(settings);
    expect(out.design?.layoutKey).toBe(computeDesign(shaft, settings).design!.layout.key);
    expect(out.message).toBe("Design loaded: 8 × Long steel shaft.");
    expect(out.catalogAdditions).toEqual([]);
  });

  it("names the model file a custom design needs, and changes nothing without it", async () => {
    const out = await loadPartFiles([jsonFile(designJson(custom))], parts);
    expect(out.part).toBeUndefined();
    expect(out.design).toBeUndefined();
    expect(out.message).toMatch(/needs widget_v2\.glb\. Choose its .glb together with the design file/);
  });

  it("still treats other JSON as a parts.json catalog", async () => {
    const out = await loadPartFiles([jsonFile(readFileSync("src/data/parts.json", "utf8"), "parts.json")], []);
    expect(out.catalogAdditions).toHaveLength(3);
    expect(out.message).toMatch(/Now choose its .glb/);
  });

  it("reports a bad design file or bad JSON plainly", async () => {
    const bad = JSON.parse(designJson(shaft));
    bad.settings.quantity = 0;
    expect((await loadPartFiles([jsonFile(JSON.stringify(bad))], parts)).message).toMatch(/settings\.quantity/);
    expect((await loadPartFiles([jsonFile("{oops", "x.json")], parts)).message).toBe(
      "x.json can't be read. This isn't valid JSON: unexpected \"o\" at line 1, column 2. Fix that and load it again.",
    );
  });
});

/** A file from fixtures/scenarios (or another folder when `name` has a slash), as a File. */
const fixtureFile = (name: string) => {
  const path = name.includes("/") ? name : `fixtures/scenarios/${name}`;
  return new File([readFileSync(path)], name.split("/").pop()!);
};
const known = parts;

describe("loading files with the file check (#106)", () => {
  it("a parts.json entry with only id, name, model and mass loads with its GLB; the size comes from the model", async () => {
    const out = await loadPartFiles([fixtureFile("parts-lenient.json"), fixtureFile("tall-part.glb")], known);
    expect(out.part).toMatchObject({ id: "SCN-920", name: "Post with the bare minimum", mass_kg: 12, massAssumed: false, dimensions_mm: [150, 150, 1200] });
    expect(out.part?.material).toBeUndefined();
    expect(out.part?.suggested_quantities).toEqual([1, 4, 8]);
    expect(out.part?.catalogDims).toBeUndefined();
    expect(out.message).toBe("");
    expect(out.report).toBeNull();
  });

  it("an invalid entry gets a message naming the part and the field, and valid entries in the same file still load", async () => {
    const out = await loadPartFiles([fixtureFile("parts-missing-field.json"), fixtureFile("heavy-1500kg.glb")], known);
    expect(out.part).toMatchObject({ id: "SCN-901", mass_kg: 1500 });
    expect(out.catalogAdditions.map((e) => e.id)).toEqual(["SCN-901"]);
    expect(out.message).toBe("parts-missing-field.json: 1 entry skipped (SCN-900: mass_kg).");
    expect(out.report?.findings.map((f) => [f.code, f.where])).toEqual([["missing-field", "parts[0].mass_kg"]]);
    expect(out.report).toMatchObject({ opened: "heavy-1500kg.glb", loaded: true });
  });

  it("says what each of several skipped entries lacks, and loads the one that is fine", async () => {
    const out = await loadPartFiles([fixtureFile("parts-bad-entries.json"), fixtureFile("heavy-1500kg.glb")], known);
    expect(out.part?.id).toBe("SCN-901");
    expect(out.message).toBe("parts-bad-entries.json: 6 entries skipped (SCN-910: mass_kg; SCN-911: mass_kg; and 4 more).");
    expect(out.report?.findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("a schema_version 1.1 and an unknown field load, with a note naming the ignored field", async () => {
    const entry = { id: "P-1", name: "Post", model: "tall-part.glb", mass_kg: 12, colour: "grey" };
    const catalogFile = new File([JSON.stringify({ schema_version: "1.1", parts: [entry] })], "parts.json");
    const out = await loadPartFiles([catalogFile, fixtureFile("tall-part.glb")], known);
    expect(out.part).toMatchObject({ id: "P-1", mass_kg: 12 });
    expect(out.message).toBe("parts.json: 1 field ignored, newer schema_version.");
    const note = out.report?.findings.find((f) => f.code === "unknown-field");
    expect(note).toMatchObject({ severity: "note", where: "parts[0].colour" });
    expect(out.report?.findings.map((f) => f.code)).toContain("schema-newer");
  });

  it("a load with only errors changes nothing: no part, and the message says what is wrong", async () => {
    for (const [name, message] of [
      ["draco.glb", /^draco\.glb can't be opened\. That \.glb uses Draco compression/],
      ["damaged.glb", /^damaged\.glb can't be opened\. That \.glb file is damaged/],
      ["not-json.json", /^not-json\.json can't be read\. This isn't valid JSON: unexpected "t" at line 1, column 3/],
      ["parts-wrong-shape.json", /^parts-wrong-shape\.json can't be read\. Expected an object with a "parts" list/],
      ["text.gltf", /^Text \.gltf files can't be used/],
    ] as const) {
      const out = await loadPartFiles([fixtureFile(name)], known);
      expect(out.part, name).toBeUndefined();
      expect(out.design, name).toBeUndefined();
      expect(out.message, name).toMatch(message);
      expect(out.report?.loaded, name).toBe(false);
    }
  });

  it("never says only that a .glb or a design .json is needed", async () => {
    const out = await loadPartFiles([new File(["hello"], "notes.txt")], known);
    expect(out.part).toBeUndefined();
    expect(out.message).toMatch(/^notes\.txt isn't a \.glb or a \.json file, so it can't be used\. Choose a part as \.glb, with a parts.json if you have one/);
  });

  it("a parts.json alone keeps its entries and asks for the .glb", async () => {
    const out = await loadPartFiles([fixtureFile("parts.json")], known);
    expect(out.part).toBeUndefined();
    expect(out.catalogAdditions).toHaveLength(11);
    expect(out.message).toBe("Part details loaded. Now choose its .glb file.");
    expect(out.report).toBeNull();
  });

  it("two .glb files: the first opens, and the message says which was not used (#121)", async () => {
    const out = await loadPartFiles([fixtureFile("heavy-1500kg.glb"), fixtureFile("tiny-light.glb")], known);
    expect(out.part).toMatchObject({ id: "heavy-1500kg", model: "heavy-1500kg.glb", massAssumed: true });
    expect(out.message).toBe("Opened heavy-1500kg.glb. The app designs one part at a time, so tiny-light.glb was not used.");
    expect(out.report).toMatchObject({ opened: "heavy-1500kg.glb", loaded: true });
  });

  it("an absurd mass loads, as a warning (#122)", async () => {
    const out = await loadPartFiles([fixtureFile("parts-implausible.json"), fixtureFile("lopsided.glb")], known);
    expect(out.part).toMatchObject({ id: "SCN-940", mass_kg: 99_999_999 });
    expect(out.report?.findings.find((f) => f.code === "implausible-mass")).toMatchObject({ severity: "warning", where: "parts[0].mass_kg" });
  });

  it("model_units from parts.json sets the file's units instead of the guess", async () => {
    const out = await loadPartFiles([fixtureFile("parts-units-mm.json"), fixtureFile("shaft-millimetres.glb")], known);
    expect(out.part).toMatchObject({ id: "SCN-950", modelUnits: "mm", upAxis: "z", unitsGuessed: false, dimensions_mm: [300, 200, 200] });
    expect(out.message).toBe("");
    // When the declared units can't give the entry's size but another reading does, that reading is used, with a warning.
    const wrong = await loadPartFiles([fixtureFile("parts-units-wrong.json"), fixtureFile("shaft-millimetres.glb")], known);
    expect(wrong.part).toMatchObject({ modelUnits: "mm", unitsGuessed: false });
    expect(wrong.report?.findings.map((f) => f.code)).toEqual(["units-disagree"]);
  });

  it("a bare .glb is a stand-in part; a clean load says nothing and keeps no report", async () => {
    const out = await loadPartFiles([fixtureFile("tiny-light.glb")], known);
    expect(out.part).toMatchObject({ id: "tiny-light", mass_kg: 10, massAssumed: true, modelUnits: "m", unitsGuessed: true });
    expect(out.message).toBe("");
    expect(out.report).toBeNull();
  });

  it("a file in inches is read as inches from its size, with a note", async () => {
    const out = await loadPartFiles([fixtureFile("fixtures/units-axis/bracket-inches.glb")], known);
    expect(out.part).toMatchObject({ modelUnits: "in", unitsGuessed: true });
    expect(out.report?.findings.map((f) => [f.code, f.severity])).toEqual([["units-guessed", "note"]]);
  });

  it("a file with a bundled catalog name needs no parts.json and keeps the catalog size", async () => {
    const out = await loadPartFiles([fixtureFile("public/parts/PART-002-long-steel-shaft.glb")], known);
    expect(out.part).toMatchObject({ id: "PART-002", unitsGuessed: false });
    expect(out.part?.catalogDims).toEqual(parts.find((p) => p.id === "PART-002")!.dimensions_mm);
    expect(out.report).toBeNull();
  });

  it("a size that disagrees with the entry is kept as the entry's, and the report says so", async () => {
    const out = await loadPartFiles([fixtureFile("parts-size-mismatch.json"), fixtureFile("size-mismatch.glb")], known);
    expect(out.part?.dimensions_mm).toEqual([360, 220, 258]);
    expect(out.report?.findings.map((f) => f.code)).toEqual(["size-mismatch"]);
    expect(out.message).toBe("size-mismatch.glb: model size differs from parts.json.");
  });
});
