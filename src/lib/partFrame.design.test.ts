import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { parseDesignFile, serializeDesign } from "@/domain/designFile";
import { APP } from "./appInfo";
import { designFilePart, loadDesign, loadPartFiles } from "./loadPart";
import { framePart, type LoadedPart } from "./part";

/** A saved design reopens with the units and axis it was saved with (#105). */

const fileOf = (name: string) => {
  const b = readFileSync(`fixtures/units-axis/${name}`);
  return new File([b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer], name, { type: "model/gltf-binary" });
};
const settings = { ...DEFAULT_SETTINGS, quantity: 4 };

function savedText(part: LoadedPart) {
  const design = computeDesign(part, settings).design!;
  return serializeDesign({ app: APP, part: designFilePart(part), settings, layoutKey: design.layout.key, design, savedAt: "2026-11-17T00:00:00Z" });
}

async function reopened(text: string, glb: File) {
  const parsed = parseDesignFile(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return loadDesign(parsed.file, [glb]);
}

describe("reopening a design", () => {
  it("measures a Y-up file the way it was saved", async () => {
    const glb = fileOf("bracket-y-up.glb");
    const loaded = (await loadPartFiles([glb], [])).part!;
    const part = framePart(loaded, { units: "m", up: "y" });
    const out = await reopened(savedText(part), glb);
    expect(out.part).toMatchObject({ modelUnits: "m", upAxis: "y", unitsGuessed: false });
    expect(out.part!.dimensions_mm).toEqual(part.dimensions_mm);
    // No "different size" note: the same units and axis gave the saved size.
    expect(out.message).toBe("Design loaded: 4 × Bracket y up.");
  });

  it("keeps a units guess marked as a guess", async () => {
    const glb = fileOf("bracket-inches.glb");
    const loaded = (await loadPartFiles([glb], [])).part!;
    expect(loaded).toMatchObject({ modelUnits: "in", unitsGuessed: true });
    expect((await reopened(savedText(loaded), glb)).part).toMatchObject({ modelUnits: "in", unitsGuessed: true });
    const chosen = framePart(loaded, { units: "in", up: "z" });
    expect((await reopened(savedText(chosen), glb)).part).toMatchObject({ modelUnits: "in", unitsGuessed: false });
  });

  it("finds the units of a file saved before they were recorded from its saved size", async () => {
    for (const [name, units] of [
      ["bracket-millimetres.glb", "mm"],
      ["bracket-inches.glb", "in"],
      ["bracket-metres.glb", "m"],
    ] as const) {
      const glb = fileOf(name);
      const loaded = (await loadPartFiles([glb], [])).part!;
      const doc = JSON.parse(savedText(framePart(loaded, { units, up: "z" })));
      doc.schemaVersion = 2;
      delete doc.part.units;
      delete doc.part.up;
      delete doc.part.unitsGuessed;
      const out = await reopened(JSON.stringify(doc), glb);
      expect(out.part).toMatchObject({ modelUnits: units, upAxis: "z", unitsGuessed: false });
      expect(out.message).not.toContain("different size");
    }
  });

  it("follows the file, and says so, when it is not the size that was saved", async () => {
    const loaded = (await loadPartFiles([fileOf("bracket-metres.glb")], [])).part!;
    const text = savedText(framePart(loaded, { units: "m", up: "z" }));
    // The same design with the inches file: read in metres, it is 25.4 times bigger than saved.
    const out = await reopened(text, fileOf("bracket-inches.glb"));
    expect(out.message).toContain("is a different size from the saved part");
  });
});
