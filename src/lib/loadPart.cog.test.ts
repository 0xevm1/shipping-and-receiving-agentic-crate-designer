import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parts } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { DESIGN_SCHEMA_VERSION, parseDesignFile, serializeDesign } from "@/domain/designFile";
import { createEntry } from "@/domain/designLibrary";
import { readShareHash, shareHash } from "@/domain/shareLink";
import { readGlb } from "@/domain/glb";
import { APP } from "./appInfo";
import { designFilePart, loadDesign, loadPartFiles } from "./loadPart";
import { catalogPart, type LoadedPart } from "./part";

/** The centre of gravity through load and save (#110): parts.json, the design file, the library, the share link. */
const fixture = (path: string) => new File([readFileSync(path)], path.split("/").pop()!);
const text = (name: string, content: string) => new File([content], name);

const shaft = catalogPart(parts.find((p) => p.id === "PART-002")!);
const withCog = (cog: LoadedPart["cog"]): LoadedPart => ({ ...shaft, cog });
const SETTINGS = { ...DEFAULT_SETTINGS, quantity: 2 };
const json = (part: LoadedPart) => {
  const design = computeDesign(part, SETTINGS).design!;
  return serializeDesign({ app: APP, part: designFilePart(part), settings: SETTINGS, layoutKey: design.layout.key, design, savedAt: "2026-11-17T00:00:00Z" });
};

describe("parts.json cog_mm into the part", () => {
  const centreMm = (path: string, k: number) => {
    const r = readGlb(readFileSync(path));
    if (!("info" in r)) throw new Error("unreadable");
    return r.info.center.map((v) => v * k);
  };

  it("opens the part with a supplied centre, as an offset from the box centre", async () => {
    const [cx, cy, cz] = centreMm("fixtures/units-axis/bracket-metres.glb", 1000);
    const entry = { id: "BR-1", name: "Bracket", model: "bracket-metres.glb", mass_kg: 20, cog_mm: [cx + 40, cy - 10, cz] };
    const out = await loadPartFiles([text("parts.json", JSON.stringify({ parts: [entry] })), fixture("fixtures/units-axis/bracket-metres.glb")], []);
    const cog = out.part?.cog;
    expect(cog?.source).toBe("supplied");
    expect(cog?.offsetMm.map((v) => Math.round(v * 100) / 100)).toEqual([40, -10, 0]);
  });

  it("opens an inches file with a supplied centre in mm, and a Y-up file in the Z-up frame", async () => {
    const [ix, iy, iz] = centreMm("fixtures/units-axis/bracket-inches.glb", 25.4);
    const inches = await loadPartFiles(
      [
        text(
          "parts.json",
          JSON.stringify({ parts: [{ id: "B", name: "B", model: "bracket-inches.glb", mass_kg: 5, model_units: "in", cog_mm: [ix, iy + 20, iz - 5] }] }),
        ),
        fixture("fixtures/units-axis/bracket-inches.glb"),
      ],
      [],
    );
    expect(inches.part?.cog?.offsetMm.map((v) => Math.round(v * 10) / 10)).toEqual([0, 20, -5]);

    const [yx, yy, yz] = centreMm("fixtures/units-axis/bracket-y-up.glb", 1000);
    const yUp = await loadPartFiles(
      [
        text(
          "parts.json",
          JSON.stringify({
            parts: [{ id: "Y", name: "Y", model: "bracket-y-up.glb", mass_kg: 5, dimensions_mm: [360, 220, 258], cog_mm: [yx + 30, yy + 20, yz + 10] }],
          }),
        ),
        fixture("fixtures/units-axis/bracket-y-up.glb"),
      ],
      [],
    );
    expect(yUp.part?.upAxis).toBe("y");
    expect(yUp.part?.cog?.offsetMm.map((v) => Math.round(v * 10) / 10)).toEqual([30, -10, 20]);
  });

  it("opens the part without one when the entry has none or it is outside the box", async () => {
    const plain = await loadPartFiles([fixture("fixtures/scenarios/parts.json"), fixture("fixtures/scenarios/tall-part.glb")], []);
    expect(plain.part?.cog).toBeUndefined();
    const [cx, cy, cz] = centreMm("fixtures/units-axis/bracket-metres.glb", 1000);
    const far = await loadPartFiles(
      [
        text("parts.json", JSON.stringify({ parts: [{ id: "BR", name: "Bracket", model: "bracket-metres.glb", mass_kg: 20, cog_mm: [cx + 5000, cy, cz] }] })),
        fixture("fixtures/units-axis/bracket-metres.glb"),
      ],
      [],
    );
    expect(far.part?.cog).toBeUndefined();
    expect(far.part?.id).toBe("BR");
    expect(far.report).toBeTruthy();
  });
});

describe("the design file carries the centre of gravity", () => {
  const cog = { offsetMm: [-85, 0.1, 0] as [number, number, number], source: "supplied" as const };

  it("writes it with the part as an optional field (no format bump of its own), and reads it back", () => {
    const text = json(withCog(cog));
    expect(JSON.parse(text).part.cog).toEqual(cog);
    expect(JSON.parse(text).schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(DESIGN_SCHEMA_VERSION).toBe(4);
    const parsed = parseDesignFile(text);
    expect(parsed.ok && parsed.file.part.cog).toEqual(cog);
    // A part without one writes none.
    expect(JSON.parse(json(shaft)).part).not.toHaveProperty("cog");
  });

  it("opens a file from before the field as it did: no centre, so the estimate or the assumption applies", async () => {
    const old = JSON.parse(json(shaft));
    expect(old.part.cog).toBeUndefined();
    const parsed = parseDesignFile(JSON.stringify(old));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = await loadDesign(parsed.file, [], parts);
    expect(out.part?.cog).toBeUndefined();
  });

  it("restores a supplied or edited centre on a catalog part, and rebuilds the same crate", async () => {
    const parsed = parseDesignFile(json(withCog(cog)));
    if (!parsed.ok) throw new Error("unreadable");
    const out = await loadDesign(parsed.file, [], parts);
    expect(out.part?.cog).toEqual(cog);
    expect(out.message).not.toMatch(/Gross is now|crate is now/);
  });

  it("drops a saved centre that is outside the part's box", async () => {
    const parsed = parseDesignFile(json(withCog(cog)));
    if (!parsed.ok) throw new Error("unreadable");
    parsed.file.part.cog = { offsetMm: [5000, 0, 0], source: "supplied" };
    const out = await loadDesign(parsed.file, [], parts);
    expect(out.part?.cog).toBeUndefined();
  });

  it("travels in the library entry and the share link", () => {
    const parsed = parseDesignFile(json(withCog(cog)));
    if (!parsed.ok) throw new Error("unreadable");
    const entry = createEntry({ id: "1", name: "Lopsided", savedAt: "2026-11-17T00:00:00Z", design: parsed.file });
    expect(entry.ok && entry.entry.design.part.cog).toEqual(cog);
    const back = readShareHash(shareHash(parsed.file));
    expect(back?.ok && back.file.part.cog).toEqual(cog);
  });

  it("rejects a damaged centre when the file is read", () => {
    const doc = JSON.parse(json(withCog(cog)));
    doc.part.cog = { offsetMm: [1, 2], source: "supplied" };
    expect(parseDesignFile(JSON.stringify(doc)).ok).toBe(false);
    doc.part.cog = { offsetMm: [1, 2, 3], source: "guessed" };
    expect(parseDesignFile(JSON.stringify(doc)).ok).toBe(false);
  });
});
