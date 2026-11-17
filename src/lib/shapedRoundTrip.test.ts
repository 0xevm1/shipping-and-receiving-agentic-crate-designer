import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parts } from "@/domain/catalog";
import { SHAPED_BLOCK } from "@/domain/crate";
import { DEFAULT_SETTINGS, type Ranking } from "@/domain/design";
import { fileProfile, parseDesignFile, restoreDesign, serializeDesign, type DesignFile } from "@/domain/designFile";
import type { PartProfile } from "@/domain/profile";
import { decodeProfile, encodeProfile } from "@/domain/profileCodec";
import { shareHash } from "@/domain/shareLink";
import { planShipment } from "@/domain/shipment";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { sweepQuantities } from "@/domain/sweep";
import { catalogPart, type LoadedPart } from "./part";
import { APP } from "./appInfo";
import { designFilePart } from "./loadPart";
import { metricText } from "./message";
import { buildPartProfile } from "./partProfile";
import { buildPrintable, printableFromDesignFile } from "./printable";
import { printHash } from "./printLink";
import { weight } from "./units";

/**
 * The same design file must give the same crate everywhere it is opened: the app after a reload,
 * a share link or the library; the print page; the zip. Shaped blocking depends on the part's
 * measured outline and the layout choice on the ranking, so both travel in the file.
 */

const NOW = "2026-11-16T12:00:00.000Z";
const profiles = {} as Record<string, PartProfile>;

beforeAll(async () => {
  for (const p of parts) {
    const b = readFileSync(`public/parts/${p.model}`);
    const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "");
    profiles[p.id] = buildPartProfile(gltf.scene, 1000);
  }
});

/** The app's own design for a catalog part whose profile has been measured, saved as the app saves it. */
function savedDesign(id: string, quantity: number, ranking: Ranking = "volume") {
  const entry = parts.find((p) => p.id === id)!;
  const part: LoadedPart = { ...catalogPart(entry), profile: profiles[id] };
  const settings = { ...DEFAULT_SETTINGS, quantity };
  const plan = planShipment(part, settings, null, DEFAULT_STANDARDS, ranking);
  const design = plan.crates[0].result.design!;
  const text = serializeDesign({ part: designFilePart(part), settings, layoutKey: design.layout.key, ranking, design, plan, app: APP, savedAt: NOW });
  return { entry, part, plan, design, text };
}

describe("the part outline in the design file", () => {
  it("packs and unpacks every catalog profile exactly", () => {
    for (const p of parts) {
      const packed = encodeProfile(profiles[p.id]);
      expect(decodeProfile(packed)).toEqual(profiles[p.id]);
    }
  });

  it("refuses an outline whose data is damaged", () => {
    const { text } = savedDesign("PART-001", 4);
    const json = JSON.parse(text);
    json.part.outline.data = "AAAA";
    const r = parseDesignFile(JSON.stringify(json));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/part\.outline/);
  });

  it("keeps links to a size worth sharing (about 1.5 KB, and 3.5 KB for the housing)", () => {
    for (const id of ["PART-001", "PART-002", "PART-003"]) {
      const { text, part, plan, design } = savedDesign(id, entryQuantity(id));
      const without = serializeDesign({
        part: designFilePart({ ...part, profile: undefined }),
        settings: { ...DEFAULT_SETTINGS, quantity: entryQuantity(id) },
        layoutKey: design.layout.key,
        design,
        plan,
        app: APP,
        savedAt: NOW,
      });
      const file = (parseDesignFile(text) as { ok: true; file: DesignFile }).file;
      const withoutFile = (parseDesignFile(without) as { ok: true; file: DesignFile }).file;
      const sizes = {
        share: shareHash(file).length,
        shareWithoutOutline: shareHash(withoutFile).length,
        print: printHash(text, "imperial", true).length,
        printWithoutOutline: printHash(without, "imperial", true).length,
      };
      expect(sizes.share).toBeLessThan(4000);
      expect(sizes.print).toBeLessThan(4000);
      // The outline is the bulk of it, and it is far smaller than the raw samples (88-138 KB as JSON).
      expect(sizes.share - sizes.shareWithoutOutline).toBeLessThan(3000);
    }
  });
});

const entryQuantity = (id: string) => parts.find((p) => p.id === id)!.suggested_quantities[1] ?? 4;

describe("the same design file gives the same crate everywhere", () => {
  it("has shaped blocks in the saved design, so there is something to lose", () => {
    const { design } = savedDesign("PART-001", 4);
    expect(design.members.filter((m) => m.label === SHAPED_BLOCK).length).toBe(12);
  });

  for (const id of ["PART-001", "PART-002", "PART-003"]) {
    it(`${id}: reopening from the file reproduces the saved crate, quietly`, () => {
      const q = entryQuantity(id);
      const { text, entry, design } = savedDesign(id, q);
      const file = (parseDesignFile(text) as { ok: true; file: DesignFile }).file;
      // A reload gives the catalog part with no profile: the file supplies it.
      const restored = restoreDesign(file, catalogPart(entry));
      expect(restored.notes).toEqual([]);
      expect(restored.layoutKey).toBe(design.layout.key);
      const plan = planShipment({ ...entry, profile: fileProfile(file) }, file.settings, file.layoutKey, DEFAULT_STANDARDS, file.ranking);
      expect(plan.crates[0].result.design!.grossKg).toBe(design.grossKg);
      expect(plan.crates[0].result.design!.bom).toEqual(design.bom);
    });

    it(`${id}: the print page shows the same totals as the app`, () => {
      const { text, design } = savedDesign(id, entryQuantity(id));
      const r = printableFromDesignFile(text, DEFAULT_STANDARDS, "imperial", NOW);
      if (!r.ok) throw new Error(r.error);
      expect(r.notes).toEqual([]);
      const rows = Object.fromEntries(r.doc.crates[0].spec.rows.map((x) => [x.label, x.value]));
      expect(rows["Gross"]).toBe(weight(design.grossKg, "imperial"));
      const pieces = r.doc.crates[0].build.cutList.reduce((n, g) => n + g.pieces, 0);
      expect(pieces).toBe(design.bom.reduce((n, l) => n + l.qty, 0));
      expect(r.doc.crates[0].build.totals.find((t) => t.label === "Wood screws")?.value).toBe(`~${design.screws}`);
    });
  }

  it("without the outline the bracket loses its 12 shaped blocks (what the print used to show)", () => {
    const { design, entry, plan, text } = savedDesign("PART-001", 4);
    const json = JSON.parse(text);
    delete json.part.outline;
    const bare = (parseDesignFile(JSON.stringify(json)) as { ok: true; file: DesignFile }).file;
    const plain = planShipment(entry, bare.settings, bare.layoutKey, DEFAULT_STANDARDS, bare.ranking).crates[0].result.design!;
    expect(plain.members.length).toBe(design.members.length - 12);
    expect(plain.grossKg).toBeLessThan(design.grossKg);
    // A file that was saved before the outline was measured describes a crate without one: nothing to explain.
    const early = serializeDesign({
      part: designFilePart(catalogPart(entry)),
      settings: bare.settings,
      layoutKey: plain.layout.key,
      design: plain,
      plan,
      app: APP,
      savedAt: NOW,
    });
    const earlyFile = (parseDesignFile(early) as { ok: true; file: DesignFile }).file;
    expect(restoreDesign(earlyFile, entry).notes).toEqual([]);
  });

  it("an older (format 1) file still opens without a note: the measured model settles the totals", () => {
    const { text, entry } = savedDesign("PART-001", 4);
    const json = JSON.parse(text);
    delete json.part.outline;
    delete json.ranking;
    json.schemaVersion = 1;
    const r = parseDesignFile(JSON.stringify(json));
    if (!r.ok) throw new Error(r.error);
    expect(r.file.ranking).toBe("volume");
    const notes = restoreDesign(r.file, catalogPart(entry)).notes.map(metricText);
    // Nothing about file history: the viewer measures the model, and the totals return to the saved ones.
    expect(notes).toEqual([]);
    // Once the model is measured and the part has its outline, the saved crate comes back exactly.
    expect(restoreDesign(r.file, { ...catalogPart(entry), profile: profiles["PART-001"] }).notes).toEqual([]);
  });

  it("a difference that remains is worded in the selected units", () => {
    const { text, entry } = savedDesign("PART-001", 4);
    const file = (parseDesignFile(text) as { ok: true; file: DesignFile }).file;
    const heavier = { ...catalogPart(entry), mass_kg: entry.mass_kg * 2 };
    const notes = restoreDesign(file, heavier).notes;
    expect(notes.map(metricText).join(" ")).toMatch(/Gross is now \d+ kg \(was 138 kg\)/);
    const r = printableFromDesignFile(
      JSON.stringify({ ...JSON.parse(text), part: { ...JSON.parse(text).part, mass_kg: entry.mass_kg * 2 } }),
      DEFAULT_STANDARDS,
      "imperial",
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/ lb/);
    expect(r.notes.join(" ")).not.toMatch(/ kg/);
  });
});

describe("the ranking travels with the design", () => {
  for (const ranking of ["cost", "density"] as const) {
    it(`${ranking}: the file, the print and the PDF model explain the winner by ${ranking}`, () => {
      const { text, plan, design, part } = savedDesign("PART-001", 4, ranking);
      expect(JSON.parse(text).ranking).toBe(ranking);
      const doc = buildPrintable({ part, plan, standards: DEFAULT_STANDARDS, units: "imperial", ranking, generatedAt: NOW });
      const why = doc.crates[0].spec.layout.why;
      expect(why).toMatch(ranking === "cost" ? /^Ranked by crate cost/ : /^Ranked by freight/);
      expect(why).not.toMatch(/volume/);
      const r = printableFromDesignFile(text, DEFAULT_STANDARDS, "imperial", NOW);
      if (!r.ok) throw new Error(r.error);
      expect(r.doc.crates[0].spec.layout.why).toBe(why);
      expect(r.doc).toEqual(doc);
      expect(r.doc.crates[0].spec.layout.chosen).toContain(design.layout.orientation.label.toLowerCase());
    });
  }

  it("a design picked by hand still says so under a ranking", () => {
    const { part, plan } = savedDesign("PART-001", 4, "cost");
    const other = plan.crates[0].result.layouts[1];
    const picked = planShipment(part, { ...DEFAULT_SETTINGS, quantity: 4 }, other.key, DEFAULT_STANDARDS, "cost");
    const doc = buildPrintable({ part, plan: picked, standards: DEFAULT_STANDARDS, units: "imperial", ranking: "cost", generatedAt: NOW });
    expect(doc.crates[0].spec.layout.why).toMatch(/picked by hand/);
  });

  it("the sweep's recommended crate says it is the recommendation, not a pick by hand, and how the list is ranked", () => {
    const { part } = savedDesign("PART-001", 4);
    const sweep = sweepQuantities(part, { ...DEFAULT_SETTINGS, quantity: 1 }, DEFAULT_STANDARDS);
    const rec = sweep.recommendation!;
    const plan = planShipment(part, { ...DEFAULT_SETTINGS, quantity: rec.quantity }, rec.crate.layoutKey, DEFAULT_STANDARDS, "volume");
    // Ranked by volume, the list's top is another layout than the one cheapest per part.
    expect(plan.crates[0].result.layouts[0].key).not.toBe(rec.crate.layoutKey);
    const doc = buildPrintable({ part, plan, sweep, standards: DEFAULT_STANDARDS, units: "imperial", ranking: "volume", generatedAt: NOW });
    expect(doc.crates[0].spec.layout.why).toMatch(/^Recommended: cheapest per part\. .* ranked by volume, where it ships/);
    expect(doc.crates[0].spec.layout.why).not.toMatch(/picked by hand/);
  });
});
