import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "@/domain/catalog";
import { renderMessage } from "./message";
import {
  checkFiles,
  massWarning,
  MAX_PLAUSIBLE_MASS_KG,
  MIN_PLAUSIBLE_MASS_KG,
  parseModelUnits,
  sizeMatches,
  type FileCheck,
  type FileInput,
} from "./fileCheck";

const FIXTURES = "fixtures/scenarios";
const buffer = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
/** A .glb from fixtures/scenarios (or another folder when `name` has a slash). */
const glb = (name: string): FileInput => ({ name: name.split("/").pop()!, content: buffer(name.includes("/") ? name : `${FIXTURES}/${name}`) });
/** A .json from fixtures/scenarios. */
const fixture = (name: string): FileInput => ({ name, content: readFileSync(`${FIXTURES}/${name}`, "utf8") });
const text = (name: string, content: string): FileInput => ({ name, content });

const GOOD = { id: "P-1", name: "Part one", model: "a.glb", mass_kg: 12.5 };
/** A parts.json with these entries (and top-level fields). */
const catalogOf = (entries: unknown[], top: object = {}) => text("parts.json", JSON.stringify({ parts: entries, ...top }));
const say = (f: { message: Parameters<typeof renderMessage>[0] }) => renderMessage(f.message, "metric");
const codes = (c: FileCheck) => c.findings.map((f) => f.code);
const one = (c: FileCheck, code: string) => {
  const f = c.findings.filter((x) => x.code === code);
  expect(f, `${code} in ${JSON.stringify(codes(c))}`).toHaveLength(1);
  return f[0];
};

describe("parts.json: the file", () => {
  it("says where the JSON breaks (line and column), whatever the engine's own message says", () => {
    const trailing = checkFiles([fixture("parts-trailing-comma.json")]);
    expect(one(trailing, "json-syntax")).toMatchObject({ severity: "error", file: "parts-trailing-comma.json" });
    expect(say(one(trailing, "json-syntax"))).toBe('This isn\'t valid JSON: unexpected "]" at line 4, column 3. Fix that and load it again.');
    expect(say(one(checkFiles([fixture("not-json.json")]), "json-syntax"))).toMatch(/at line 1, column 3\./);
    expect(say(one(checkFiles([text("x.json", '{"parts": [')]), "json-syntax"))).toMatch(/ends before the JSON is complete at line 1, column 12/);
    expect(say(one(checkFiles([text("x.json", '{"a": "b\n"}')]), "json-syntax"))).toMatch(/at line 1, column 9\./);
  });

  it("reads a file that starts with a byte order mark", () => {
    const c = checkFiles([text("parts.json", `﻿${JSON.stringify({ parts: [GOOD] })}`)]);
    expect(c.entries).toHaveLength(1);
    expect(c.findings.filter((f) => f.severity !== "note")).toEqual([]);
  });

  it.each([
    ["a list with no wrapper", JSON.stringify([GOOD]), /found a list of parts with no wrapper/],
    ["an object with other keys", JSON.stringify({ items: [GOOD], count: 1 }), /found only "items", "count"/],
    ["null", "null", /found null/],
    ["parts that isn't a list", JSON.stringify({ parts: "a.glb" }), /found only "parts"/],
  ])("wrong top-level shape: %s", (_, content, message) => {
    const c = checkFiles([text("parts.json", content)]);
    expect(one(c, "shape")).toMatchObject({ severity: "error", file: "parts.json" });
    expect(say(one(c, "shape"))).toMatch(message);
    expect(c.entries).toEqual([]);
  });

  it("an empty parts list is an error", () => {
    expect(one(checkFiles([catalogOf([])]), "shape")).toMatchObject({ severity: "error", where: "parts" });
  });

  it.each([
    ["1.0", false],
    ["1", false],
    ["0.9", false],
    [1, false],
    ["1.1", true],
    ["2.0", true],
    [3, true],
  ])("schema_version %j newer than known: %s", (version, newer) => {
    const c = checkFiles([catalogOf([GOOD], { schema_version: version })]);
    expect(codes(c).includes("schema-newer")).toBe(newer);
    expect(c.entries).toHaveLength(1);
    if (newer) expect(one(c, "schema-newer")).toMatchObject({ severity: "warning", where: "schema_version" });
  });

  it("names fields the app doesn't use, at the top and in an entry, as notes", () => {
    const c = checkFiles([catalogOf([{ ...GOOD, colour: "grey", supplier: "Acme" }], { owner: "Plant 4", coordinate_system: "Z up", metadata_note: "x" })]);
    const unknown = c.findings.filter((f) => f.code === "unknown-field");
    expect(unknown.map((f) => [f.where, f.severity])).toEqual([
      ["owner", "note"],
      ["parts[0].colour", "note"],
      ["parts[0].supplier", "note"],
    ]);
    expect(say(unknown[1])).toBe('P-1 has a field "colour" that the app doesn\'t use, so it was ignored.');
    expect(c.catalogs[0].ignoredFields).toBe(3);
    expect(c.entries).toHaveLength(1);
  });
});

describe("parts.json: entries", () => {
  it("accepts an entry with only id, name, model and mass_kg (#106)", () => {
    const c = checkFiles([catalogOf([GOOD])]);
    expect(c.findings).toEqual([]);
    expect(c.entries).toEqual([GOOD]);
  });

  // [what is wrong, the entry, the code, where, a piece of the sentence]
  it.each([
    ["no id", { ...GOOD, id: undefined }, "missing-field", "parts[0].id", /^Part one has no id, so it was skipped\. Give it a unique id/],
    ["no name", { ...GOOD, name: undefined }, "missing-field", "parts[0].name", /^P-1 has no name, so it was skipped/],
    ["no model", { ...GOOD, model: undefined }, "missing-field", "parts[0].model", /^P-1 has no model, so it was skipped\. Name its file/],
    [
      "no mass",
      { ...GOOD, mass_kg: undefined },
      "missing-field",
      "parts[0].mass_kg",
      /^P-1 has no mass_kg, so it was skipped\. Add the mass of one part in kilograms/,
    ],
    ["a null mass", { ...GOOD, mass_kg: null }, "missing-field", "parts[0].mass_kg", /has no mass_kg/],
    ["an id that is a number", { ...GOOD, id: 7 }, "wrong-type", "parts[0].id", /id should be text but is 7/],
    ["an empty name", { ...GOOD, name: "  " }, "wrong-type", "parts[0].name", /name should be text but is empty/],
    ["a model that isn't a .glb", { ...GOOD, model: "a.step" }, "wrong-type", "parts[0].model", /model "a\.step" isn't a \.glb file name/],
    [
      "a mass written as text",
      { ...GOOD, mass_kg: "21.5 kg" },
      "wrong-type",
      "parts[0].mass_kg",
      /should be a number but is "21\.5 kg".*without quotes or a unit/,
    ],
    ["a mass that is a list", { ...GOOD, mass_kg: [1] }, "wrong-type", "parts[0].mass_kg", /should be a number but is a list/],
    ["a mass of zero", { ...GOOD, mass_kg: 0 }, "non-positive", "parts[0].mass_kg", /mass_kg is 0, but a part must weigh more than 0 kg/],
    ["a negative mass", { ...GOOD, mass_kg: -5 }, "non-positive", "parts[0].mass_kg", /mass_kg is -5/],
  ])("%s skips the entry as an error", (_, entry, code, where, message) => {
    const c = checkFiles([catalogOf([entry])]);
    expect(one(c, code)).toMatchObject({ severity: "error", file: "parts.json", where });
    expect(say(one(c, code))).toMatch(message);
    expect(c.entries).toEqual([]);
    expect(c.catalogs[0].skipped).toHaveLength(1);
  });

  it("an entry that isn't an object is skipped", () => {
    const c = checkFiles([catalogOf([GOOD, "a.glb", null])]);
    expect(c.findings.filter((f) => f.code === "entry-shape").map((f) => f.where)).toEqual(["parts[1]", "parts[2]"]);
    expect(c.entries).toHaveLength(1);
  });

  it("repeats: the second entry with an id or a model is skipped, the first counts", () => {
    const c = checkFiles([catalogOf([GOOD, { ...GOOD, model: "b.glb" }, { ...GOOD, id: "P-2" }, { ...GOOD, id: "P-3", model: "c.glb" }])]);
    expect(one(c, "duplicate-id")).toMatchObject({ severity: "error", where: "parts[1].id" });
    expect(say(one(c, "duplicate-id"))).toBe("P-1 repeats the id of parts[0], so it was skipped. Give every part its own id.");
    expect(one(c, "duplicate-model")).toMatchObject({ severity: "error", where: "parts[2].model" });
    expect(c.entries.map((e) => e.id)).toEqual(["P-1", "P-3"]);
  });

  it("valid entries load even when others in the file are bad", () => {
    const c = checkFiles([fixture("parts-bad-entries.json")]);
    expect(c.entries.map((e) => e.id)).toEqual(["SCN-901"]);
    expect(c.catalogs[0]).toMatchObject({ accepted: 1 });
    expect(c.catalogs[0].skipped.map((s) => s.label)).toEqual(["SCN-910", "SCN-911", "Part without an id", "SCN-913", "SCN-901", "SCN-915"]);
  });

  // The optional fields: wrong values are left out with a warning, and the entry still loads.
  it.each([
    ["material", { material: 42 }, /material should be text but is 42, so it was ignored\.$/],
    ["density_kg_m3", { density_kg_m3: 0 }, /density_kg_m3 should be a number above 0 but is 0, so it was ignored\.$/],
    [
      "dimensions_mm",
      { dimensions_mm: [1, 2] },
      /dimensions_mm should be three numbers.*but is a list, so it was ignored, and the size comes from the model\.$/,
    ],
    ["dimensions_mm", { dimensions_mm: [1, 2, -3] }, /so it was ignored, and the size comes from the model/],
    [
      "suggested_quantities",
      { suggested_quantities: "all" },
      /suggested_quantities should be a list of whole numbers above 0 but is "all".*1, 4 and 8 are suggested/,
    ],
    ["suggested_quantities", { suggested_quantities: [] }, /suggested_quantities should be a list/],
    ["suggested_quantities", { suggested_quantities: [1.5] }, /suggested_quantities should be a list/],
  ])("%s of the wrong kind is ignored with a warning", (field, extra, message) => {
    const c = checkFiles([catalogOf([{ ...GOOD, ...extra }])]);
    expect(one(c, "field-ignored")).toMatchObject({ severity: "warning", where: `parts[0].${field}` });
    expect(say(one(c, "field-ignored"))).toMatch(message);
    expect(c.entries).toHaveLength(1);
    expect(c.entries[0]).not.toHaveProperty(field);
  });

  it("keeps good optional fields", () => {
    const full = { ...GOOD, material: "6061", density_kg_m3: 2700, dimensions_mm: [10, 20, 30], suggested_quantities: [2, 4] };
    const c = checkFiles([catalogOf([full])]);
    expect(c.findings).toEqual([]);
    expect(c.entries[0]).toEqual(full);
  });
});

describe("parts.json: implausible numbers are warnings (#122)", () => {
  it.each([
    [
      "a mass over the limit",
      { mass_kg: MAX_PLAUSIBLE_MASS_KG + 1 },
      "implausible-mass",
      "parts[0].mass_kg",
      /^P-1: a mass_kg of 20001 is more than 20,000 kg, the most one part is taken to weigh/,
    ],
    ["the mass of the issue", { mass_kg: 99_999_999 }, "implausible-mass", "parts[0].mass_kg", /a mass_kg of 99999999 is more than 20,000 kg/],
    [
      "a mass under a gram",
      { mass_kg: 0.0002 },
      "implausible-mass",
      "parts[0].mass_kg",
      /a mass_kg of 0\.0002 is under 1 g\. Check the mass is in kilograms, not grams/,
    ],
    ["a density that is too low", { density_kg_m3: 0.5 }, "implausible-density", "parts[0].density_kg_m3", /density_kg_m3 is 0\.5, outside 1 to 25,000/],
    ["a density that is too high", { density_kg_m3: 90_000 }, "implausible-density", "parts[0].density_kg_m3", /outside 1 to 25,000/],
    [
      "a side that is too long",
      { dimensions_mm: [100, 20_001, 100] },
      "implausible-dimension",
      "parts[0].dimensions_mm",
      /dimensions_mm has 20001, outside 1 mm to 20,000 mm/,
    ],
    [
      "a side under a millimetre",
      { dimensions_mm: [0.5, 100, 100] },
      "implausible-dimension",
      "parts[0].dimensions_mm",
      /dimensions_mm has 0\.5, outside 1 mm to 20,000 mm/,
    ],
  ])("%s", (_, extra, code, where, message) => {
    const c = checkFiles([catalogOf([{ ...GOOD, ...extra }])]);
    expect(one(c, code)).toMatchObject({ severity: "warning", where });
    expect(say(one(c, code))).toMatch(message);
    // A warning never blocks: the entry is accepted as written.
    expect(c.entries).toHaveLength(1);
    expect(c.entries[0]).toMatchObject(extra);
  });

  it("the limits themselves are fine", () => {
    const c = checkFiles([catalogOf([{ ...GOOD, mass_kg: MAX_PLAUSIBLE_MASS_KG, density_kg_m3: 25_000, dimensions_mm: [1, 20_000, 5] }])]);
    expect(c.findings).toEqual([]);
  });

  it("the mass warning follows the units toggle, and is the same one the header's mass field uses", () => {
    const f = one(checkFiles([catalogOf([{ ...GOOD, mass_kg: 99_999_999 }])]), "implausible-mass");
    // The file's own number is quoted as written; the limit follows the toggle.
    expect(renderMessage(f.message, "imperial")).toMatch(/a mass_kg of 99999999 is more than 44,092 lb/);
    expect(massWarning(MAX_PLAUSIBLE_MASS_KG)).toBeNull();
    expect(massWarning(MIN_PLAUSIBLE_MASS_KG)).toBeNull();
    expect(massWarning(5)).toBeNull();
    expect(renderMessage(massWarning(99_999_999)!, "metric")).toMatch(/^99,999,999 kg is more than 20,000 kg/);
    expect(renderMessage(massWarning(0.0005)!, "metric")).toMatch(/under 1 g/);
    expect(renderMessage(massWarning(99_999_999)!, "imperial")).toMatch(/^220,461,998 lb is more than 44,092 lb/);
  });
});

describe("model_units", () => {
  it.each([
    ["meters", "m"],
    ["Metres", "m"],
    ["m", "m"],
    ["millimeters", "mm"],
    ["Millimetres", "mm"],
    ["mm", "mm"],
    ["inches", "in"],
    ["inch", "in"],
    ["in", "in"],
    ['"', "in"],
    ["cubits", null],
    ["", null],
    [5, null],
    [null, null],
  ])("%j is %s", (value, units) => {
    expect(parseModelUnits(value)).toBe(units);
  });

  it("an unknown value at the top or in an entry is a warning, and the units are guessed", () => {
    const top = checkFiles([catalogOf([GOOD], { model_units: "cubits" })]);
    expect(one(top, "units-unknown")).toMatchObject({ severity: "warning", where: "model_units" });
    expect(say(one(top, "units-unknown"))).toMatch(/model_units "cubits" isn't meters, millimeters or inches, so the units are guessed/);
    const entry = checkFiles([catalogOf([{ ...GOOD, model_units: 3 }])]);
    expect(one(entry, "units-unknown")).toMatchObject({ severity: "warning", where: "parts[0].model_units" });
    expect(entry.entries).toHaveLength(1);
    expect(entry.entries[0].model_units).toBeUndefined();
  });

  it("an entry takes the file's units unless it has its own", () => {
    const c = checkFiles([catalogOf([GOOD, { ...GOOD, id: "P-2", model: "b.glb", model_units: "inches" }], { model_units: "millimeters" })]);
    expect(c.entries.map((e) => e.model_units)).toEqual(["mm", "in"]);
  });

  it("is passed to the part frame: declared units are used, not guessed", () => {
    const c = checkFiles([fixture("parts-units-mm.json"), glb("shaft-millimetres.glb")]);
    expect(c.findings).toEqual([]);
    expect(c.opened).toMatchObject({ name: "shaft-millimetres.glb", frame: { units: "mm", up: "z" }, guessed: false });
  });

  it("is overruled by a size that only fits another reading, with a warning", () => {
    const c = checkFiles([fixture("parts-units-wrong.json"), glb("shaft-millimetres.glb")]);
    expect(one(c, "units-disagree")).toMatchObject({ severity: "warning", where: "SCN-951" });
    expect(say(one(c, "units-disagree"))).toBe(
      "model_units says metres, but the model only matches dimensions_mm read as millimetres, so it was read that way. Correct model_units in parts.json.",
    );
    expect(c.opened).toMatchObject({ frame: { units: "mm" }, guessed: false });
  });

  it("with no size to check, declared units apply even if they look wrong", () => {
    const c = checkFiles([catalogOf([{ ...GOOD, model: "shaft-millimetres.glb", model_units: "meters" }]), glb("shaft-millimetres.glb")]);
    expect(c.opened).toMatchObject({ frame: { units: "m" }, guessed: false });
    expect(codes(c)).not.toContain("units-guessed");
  });
});

describe("parts.json and the files it names", () => {
  it("an entry whose model was supplied is a clean load", () => {
    const c = checkFiles([fixture("parts.json"), glb("heavy-1500kg.glb")]);
    expect(c.findings).toEqual([]);
    expect(c.opened).toMatchObject({ name: "heavy-1500kg.glb", guessed: false, entry: { id: "SCN-001", mass_kg: 1500 } });
  });

  it("entries naming files that weren't supplied, and a .glb no entry names, are said once each", () => {
    const c = checkFiles([fixture("parts-other-models.json"), glb("tall-part.glb")]);
    expect(c.findings.map((f) => [f.code, f.severity, f.file, f.where])).toEqual([
      ["model-missing", "warning", "parts-other-models.json", "SCN-960"],
      ["model-missing", "warning", "parts-other-models.json", "SCN-961"],
      ["glb-unlisted", "note", "tall-part.glb", undefined],
    ]);
    expect(say(c.findings[0])).toBe("SCN-960 names bracket.glb, which wasn't loaded. Load that .glb with parts.json, or fix the name.");
    // The part still opens, with stand-in details.
    expect(c.opened).toMatchObject({ name: "tall-part.glb" });
    expect(c.opened?.entry).toBeUndefined();
  });

  it("a skipped entry that names the .glb is the reason it has stand-in details: said once, with no other entry nagged", () => {
    const c = checkFiles([fixture("parts-missing-field.json"), glb("missing-field.glb")]);
    expect(c.findings.map((f) => [f.file, f.code])).toEqual([
      ["parts-missing-field.json", "missing-field"],
      ["missing-field.glb", "glb-unlisted"],
    ]);
    expect(say(c.findings[1])).toBe("Its entry (SCN-900) was skipped, so it was loaded with stand-in details (10 kg).");
    // Every entry skipped: the .glb still opens, with the note.
    const only = checkFiles([text("parts.json", JSON.stringify({ parts: [{ ...GOOD, mass_kg: undefined, model: "tall-part.glb" }] })), glb("tall-part.glb")]);
    expect(only.findings.map((f) => f.code)).toEqual(["missing-field", "glb-unlisted"]);
    expect(only.opened?.name).toBe("tall-part.glb");
  });

  it("with only some of the files, the rest of the catalog isn't nagged about", () => {
    const c = checkFiles([fixture("parts.json"), glb("tall-part.glb")]);
    expect(c.findings).toEqual([]);
  });

  it("known entries count, so a .glb with a bundled catalog name needs no parts.json", () => {
    const c = checkFiles([glb("public/parts/PART-002-long-steel-shaft.glb")], { known: catalog.parts });
    expect(c.findings).toEqual([]);
    expect(c.opened?.entry?.id).toBe("PART-002");
  });

  it("only a parts.json with usable entries and no .glb is waiting for the model", () => {
    expect(checkFiles([fixture("parts.json")])).toMatchObject({ awaitingGlb: true, opened: null, findings: [] });
    expect(checkFiles([fixture("parts-bad-entries.json")]).awaitingGlb).toBe(true);
    expect(checkFiles([text("parts.json", "{oops")]).awaitingGlb).toBe(false);
  });

  it("a size that disagrees with the entry's dimensions_mm is a warning, and the units toggle reaches it", () => {
    const c = checkFiles([fixture("parts-size-mismatch.json"), glb("size-mismatch.glb")]);
    const f = one(c, "size-mismatch");
    expect(f).toMatchObject({ severity: "warning", where: "SCN-902" });
    expect(say(f)).toBe(
      "The model measures 360 mm × 220 mm × 300 mm but SCN-902 says 360 mm × 220 mm × 258 mm. Check dimensions_mm and model_units, or the file's units under the part's size at the top left.",
    );
    expect(renderMessage(f.message, "imperial")).toMatch(/measures 14\.2 in × 8\.7 in × 11\.8 in but SCN-902 says 14\.2 in × 8\.7 in × 10\.2 in/);
  });

  it("agrees with the Checks tab on what a match is: within 1 mm per side", () => {
    expect(sizeMatches([360, 220, 258.9], [360, 220, 258])).toBe(true);
    expect(sizeMatches([360, 220, 259.1], [360, 220, 258])).toBe(false);
  });
});

describe(".glb files", () => {
  const only = (name: string) => checkFiles([glb(name)]);

  // [file, code, a piece of the sentence]. The wording for Draco, Meshopt, damaged and text files is the app's old wording where it was good.
  it.each([
    ["not-a-model.glb", "glb-not-glb", /^It has a \.glb name but isn't a binary glTF\. Export the part again as \.glb; renaming a file doesn't convert it\.$/],
    ["renamed-gltf.glb", "glb-not-glb", /\(it looks like a text glTF\)/],
    ["renamed-stl.glb", "glb-not-glb", /\(it looks like an STL file\)/],
    ["old-version.glb", "glb-version", /glTF version 1, and the app reads version 2/],
    ["damaged.glb", "glb-damaged", /^That \.glb file is damaged: it is cut off or its header can't be read\. Try exporting it again\.$/],
    ["draco.glb", "glb-compressed", /^That \.glb uses Draco compression, which the viewer can't read\. Export it again without Draco compression\.$/],
    ["meshopt.glb", "glb-compressed", /uses Meshopt compression/],
    ["empty-scene.glb", "glb-no-geometry", /no 3D geometry in its scene/],
    ["single-point.glb", "glb-no-size", /All its geometry sits at one point/],
    ["flat.glb", "glb-flat", /It is flat: zero thickness along Z/],
  ])("%s can't be opened (%s)", (name, code, message) => {
    const c = only(name);
    expect(one(c, code)).toMatchObject({ severity: "error", file: name });
    expect(say(one(c, code))).toMatch(message);
    expect(c.opened).toBeNull();
  });

  it("a text .gltf and a file of another type are told apart", () => {
    const gltf = checkFiles([text("text.gltf", "{}")]);
    expect(say(one(gltf, "gltf-text"))).toBe("Text .gltf files can't be used. Export the part as a single .glb file.");
    const txt = checkFiles([text("notes.txt", "hello")]);
    expect(one(txt, "file-type")).toMatchObject({ severity: "error", file: "notes.txt" });
    expect(say(one(txt, "file-type"))).toMatch(/^notes\.txt isn't a \.glb or a \.json file, so it can't be used\. Choose a part as \.glb/);
    // Next to something usable it is only left out.
    expect(one(checkFiles([text("notes.txt", "hello"), glb("tall-part.glb")]), "file-type").severity).toBe("note");
  });

  it("a slice of a part almost flat is a warning, with the part still opened", () => {
    const c = only("sliver.glb");
    expect(one(c, "glb-sliver").severity).toBe("warning");
    expect(say(one(c, "glb-sliver"))).toMatch(/^Its thinnest side is 0\.04% of its longest, so it is almost flat/);
    expect(c.opened?.name).toBe("sliver.glb");
  });

  it("far from the origin is a note only when the distance costs precision", () => {
    const far = only("far-from-origin.glb");
    expect(one(far, "glb-off-origin").severity).toBe("note");
    expect(say(one(far, "glb-off-origin"))).toMatch(/about 866,\d{3} mm from the file's origin/);
    // The #105 fixture sits about 62 m away: within what float32 holds, so nothing is said.
    expect(checkFiles([glb("fixtures/units-axis/bracket-off-origin.glb")]).findings).toEqual([]);
  });

  it("says the units are a guess only when the guess isn't metres (what glTF itself means)", () => {
    expect(checkFiles([glb("fixtures/units-axis/bracket-metres.glb")]).findings).toEqual([]);
    for (const [name, units] of [
      ["bracket-inches.glb", "inches"],
      ["bracket-millimetres.glb", "millimetres"],
    ]) {
      const c = checkFiles([glb(`fixtures/units-axis/${name}`)]);
      expect(one(c, "units-guessed")).toMatchObject({ severity: "note", file: name });
      expect(say(one(c, "units-guessed"))).toMatch(new RegExp(`read as ${units} from its size`));
      expect(c.opened).toMatchObject({ guessed: true });
    }
  });

  it("a clean part says nothing", () => {
    for (const name of ["heavy-1500kg.glb", "tiny-light.glb", "lopsided.glb"]) expect(only(name).findings).toEqual([]);
  });
});

describe("more than one .glb (#121)", () => {
  it("opens the first and says which others weren't used", () => {
    const c = checkFiles([glb("heavy-1500kg.glb"), glb("tiny-light.glb")]);
    expect(c.opened?.name).toBe("heavy-1500kg.glb");
    expect(c.findings).toHaveLength(1);
    expect(c.findings[0]).toMatchObject({ file: "tiny-light.glb", severity: "note", code: "glb-extra" });
    expect(say(c.findings[0])).toBe("Not opened: the app designs one part at a time, and it opened heavy-1500kg.glb. Load this file on its own to design it.");
  });

  it("opens the one a parts.json entry names, whatever the order", () => {
    const c = checkFiles([glb("tiny-light.glb"), catalogOf([{ ...GOOD, model: "heavy-1500kg.glb" }]), glb("heavy-1500kg.glb")]);
    expect(c.opened?.name).toBe("heavy-1500kg.glb");
    expect(c.findings.map((f) => [f.file, f.code])).toEqual([["tiny-light.glb", "glb-extra"]]);
  });

  it("skips one that can't be opened for one that can, and reports both", () => {
    const c = checkFiles([glb("damaged.glb"), glb("tiny-light.glb"), glb("heavy-1500kg.glb")]);
    expect(c.opened?.name).toBe("tiny-light.glb");
    expect(c.findings.map((f) => [f.file, f.code])).toEqual([
      ["damaged.glb", "glb-damaged"],
      ["heavy-1500kg.glb", "glb-extra"],
    ]);
  });

  it("with a saved design, the design chooses the model and nothing is called extra", () => {
    const design = text("design.json", JSON.stringify({ kind: "crate-design", schemaVersion: 3 }));
    const c = checkFiles([design, glb("tiny-light.glb"), glb("heavy-1500kg.glb")]);
    expect(c.design?.file).toBe("design.json");
    expect(c.opened).toBeNull();
    expect(codes(c)).toEqual([]);
  });
});

describe("findings", () => {
  it("come in the order the files were picked, each with its file", () => {
    const c = checkFiles([glb("damaged.glb"), fixture("parts-bad-entries.json"), glb("draco.glb")]);
    const files = c.findings.map((f) => f.file);
    expect(files).toEqual(
      [...files].sort(
        (a, b) => ["damaged.glb", "parts-bad-entries.json", "draco.glb"].indexOf(a) - ["damaged.glb", "parts-bad-entries.json", "draco.glb"].indexOf(b),
      ),
    );
    expect(c.findings.filter((f) => f.severity === "note")).toEqual([]);
  });

  it("every finding has a stable code and a one-sentence message", () => {
    const c = checkFiles([fixture("parts-bad-entries.json"), fixture("parts-ignored-fields.json"), fixture("parts-implausible.json"), glb("sliver.glb")]);
    expect(c.findings.length).toBeGreaterThan(10);
    for (const f of c.findings) {
      expect(f.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(say(f)).toMatch(/\.$/);
    }
  });
});
