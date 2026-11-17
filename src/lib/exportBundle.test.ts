import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { parseDesignFile } from "@/domain/designFile";
import { APP } from "./appInfo";
import { planShipment } from "@/domain/shipment";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { buildBundle, bundleStem, NoCrateError, zipBundle, zipFileName, type BundleInput, type BundleMakers } from "./exportBundle";
import type { Units } from "./units";
import { catalogPart as toLoaded, type LoadedPart } from "./part";

const NOW = "2026-11-16T12:00:00.000Z";

/** Stand-in makers: the GLB names its crate's outside size; the PDF names its crate count. */
const makers: BundleMakers = {
  glb: async (d) => new TextEncoder().encode(`glTF ${d.layout.external.join("x")}`).buffer as ArrayBuffer,
  pdf: async (doc) => new TextEncoder().encode(`%PDF ${doc.crates.length}`),
};

const catalogPart = (): LoadedPart => toLoaded(getPart("PART-001"));

function input(part: LoadedPart, quantity: number, units: Units = "imperial", crateIndex = 0): BundleInput {
  const settings = { ...DEFAULT_SETTINGS, quantity };
  const plan = planShipment(part, settings, null, DEFAULT_STANDARDS);
  return { part, settings, plan, crateIndex, standards: DEFAULT_STANDARDS, units, ranking: "volume", generatedAt: NOW };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const file = (files: { name: string; data: Uint8Array }[], name: string) => {
  const f = files.find((x) => x.name === name);
  if (!f) throw new Error(`missing ${name}`);
  return text(f.data);
};

describe("Export bundle (#51)", () => {
  it("names the package and its files after the part and quantity", () => {
    expect(bundleStem("PART-001", 4)).toBe("crate-PART-001-x4");
    expect(zipFileName("PART-001", 4)).toBe("crate-PART-001-x4.zip");
    // A custom part's id can come from a file name.
    expect(bundleStem("my bracket/v2", 3)).toBe("crate-my-bracket-v2-x3");
  });

  it("packs GLB, PDF, CSV, design file and README for one crate", async () => {
    const b = await buildBundle(input(catalogPart(), 4), makers);
    expect(b.name).toBe("crate-PART-001-x4.zip");
    expect(b.files.map((f) => f.name)).toEqual(["crate-PART-001-x4.glb", "crate-PART-001-x4.pdf", "cut-list.csv", "design.json", "README.txt"]);
    expect(file(b.files, "crate-PART-001-x4.glb")).toBe("glTF 932x652x497");
    expect(file(b.files, "crate-PART-001-x4.pdf")).toBe("%PDF 1");
  });

  it("writes the CSV in the selected units", async () => {
    const imperial = await buildBundle(input(catalogPart(), 4, "imperial"), makers);
    expect(file(imperial.files, "cut-list.csv")).toMatch(/^# Units: inches/m);
    expect(file(imperial.files, "cut-list.csv")).toMatch(/component,material,stock,cut_in,qty/);
    const metric = await buildBundle(input(catalogPart(), 4, "metric"), makers);
    expect(file(metric.files, "cut-list.csv")).toMatch(/^# Units: mm and kg$/m);
    expect(file(metric.files, "cut-list.csv")).toMatch(/cut_mm/);
  });

  it("has a design file that re-imports to the same crate", async () => {
    const b = await buildBundle(input(catalogPart(), 4), makers);
    const r = parseDesignFile(file(b.files, "design.json"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.part).toMatchObject({ source: "catalog", id: "PART-001" });
    expect(r.file.settings.quantity).toBe(4);
    expect(r.file.summary.outsideMm).toEqual([932, 652, 497]);
    expect(r.file.savedAt).toBe(NOW);
  });

  it("has a README naming every file, the app version, the date and the units", async () => {
    const b = await buildBundle(input(catalogPart(), 4, "metric"), makers);
    const readme = file(b.files, "README.txt");
    for (const f of b.files) expect(readme).toContain(f.name);
    expect(readme).toContain(`crate-designer ${APP.version}`);
    expect(readme).toContain("2026-11-16");
    expect(readme).toContain("PART-001 Machined steel bracket");
    expect(readme).toMatch(/Units: +millimetres and kilograms/);
    expect(readme).toContain("nothing was uploaded");
    const imperial = file((await buildBundle(input(catalogPart(), 4), makers)).files, "README.txt");
    expect(imperial).toMatch(/Units: +inches and pounds/);
  });

  it("dates the README in the zone it is made in, and records the ranking in design.json", async () => {
    const late = { ...input(catalogPart(), 4), generatedAt: "2026-11-17T07:16:00.000Z", ranking: "cost" as const };
    const la = await buildBundle({ ...late, timeZone: "America/Los_Angeles" }, makers);
    expect(file(la.files, "README.txt")).toMatch(/Made: +2026-11-16 \(2026-11-17T07:16:00.000Z\)/);
    const utc = await buildBundle({ ...late, timeZone: "UTC" }, makers);
    expect(file(utc.files, "README.txt")).toMatch(/Made: +2026-11-17 /);
    const parsed = parseDesignFile(file(la.files, "design.json"));
    expect(parsed.ok && parsed.file.ranking).toBe("cost");
  });

  it("packs every crate type of a split batch, and the whole shipment's cut list", async () => {
    const inp = input(catalogPart(), 200);
    expect(inp.plan.split).toBe(true);
    expect(inp.plan.crates.map((c) => c.label)).toEqual(["A", "B"]);
    const b = await buildBundle(inp, makers);
    expect(b.name).toBe("crate-PART-001-x200.zip");
    expect(b.files.map((f) => f.name)).toEqual([
      "crate-PART-001-x200-crate-A.glb",
      "crate-PART-001-x200-crate-B.glb",
      "crate-PART-001-x200.pdf",
      "cut-list-crate-A.csv",
      "cut-list-crate-B.csv",
      "shipment-cut-list.csv",
      "design.json",
      "README.txt",
    ]);
    // One GLB per type, each its own crate; one PDF with both types.
    expect(file(b.files, "crate-PART-001-x200-crate-A.glb")).not.toBe(file(b.files, "crate-PART-001-x200-crate-B.glb"));
    expect(file(b.files, "crate-PART-001-x200.pdf")).toBe("%PDF 2");
    expect(file(b.files, "cut-list-crate-A.csv")).toMatch(/^# Crate for 30 x PART-001/);
    expect(file(b.files, "cut-list-crate-B.csv")).toMatch(/^# Crate for 20 x PART-001/);
    expect(file(b.files, "shipment-cut-list.csv")).toMatch(/^# Shipment of 200 x PART-001/);
    expect(file(b.files, "README.txt")).toContain("shipping as 6 x crate A (30 each) + 1 x crate B (20)");
    const r = parseDesignFile(file(b.files, "design.json"));
    expect(r.ok && r.file.summary.shipment).toEqual([
      { count: 6, quantity: 30 },
      { count: 1, quantity: 20 },
    ]);
  });

  it("records the crate type on screen in the design file", async () => {
    const b = await buildBundle(input(catalogPart(), 200, "imperial", 1), makers);
    const r = parseDesignFile(file(b.files, "design.json"));
    expect(r.ok && r.file.summary.quantity).toBe(20);
  });

  it("works for a custom (loaded) part, and says which GLB to load with the design file", async () => {
    const bracket = getPart("PART-001");
    const custom: LoadedPart = {
      ...catalogPart(),
      id: "my bracket",
      name: "Welded frame",
      material: undefined,
      mass_kg: 10,
      massAssumed: true,
      model: "my bracket.glb",
      modelUrl: "blob:x",
      catalogDims: undefined,
      dimensions_mm: bracket.dimensions_mm,
    };
    const b = await buildBundle(input(custom, 2), makers);
    expect(b.name).toBe("crate-my-bracket-x2.zip");
    expect(b.files.map((f) => f.name)).toEqual(["crate-my-bracket-x2.glb", "crate-my-bracket-x2.pdf", "cut-list.csv", "design.json", "README.txt"]);
    const r = parseDesignFile(file(b.files, "design.json"));
    expect(r.ok && r.file.part).toMatchObject({ source: "custom", id: "my bracket", massAssumed: true, model: "my bracket.glb" });
    expect(file(b.files, "README.txt")).toContain("load my bracket.glb with it");
  });

  it("refuses when there is no crate", async () => {
    const inp = input(catalogPart(), 4);
    const plan = { ...inp.plan, problem: { id: "part-too-large", title: "Too big", detail: ["Nothing fits."] } } as BundleInput["plan"];
    await expect(buildBundle({ ...inp, plan }, makers)).rejects.toBeInstanceOf(NoCrateError);
  });

  it("zips the files so they unzip byte for byte", async () => {
    const b = await buildBundle(input(catalogPart(), 4), makers);
    const zip = zipBundle(b.files, new Date(NOW));
    // "PK\x03\x04", a local file header.
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const out = unzipSync(zip);
    expect(Object.keys(out)).toEqual(b.files.map((f) => f.name));
    for (const f of b.files) expect(out[f.name]).toEqual(f.data);
  });
});
