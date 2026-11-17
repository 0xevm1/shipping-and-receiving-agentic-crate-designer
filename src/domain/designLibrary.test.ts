import { describe, expect, it } from "vitest";
import { parts } from "./catalog";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { parseDesignFile, serializeDesign, type DesignFile, type DesignFilePart } from "./designFile";
import {
  createEntry,
  entriesForPart,
  LIBRARY_KIND,
  LIBRARY_VERSION,
  libraryToJson,
  mergeEntries,
  parseLibrary,
  partKey,
  removeEntry,
  renameEntry,
  restoreEntry,
  type SavedDesign,
} from "./designLibrary";
import type { CrateSettings } from "./schema";

function catalogFilePart(id: string): DesignFilePart {
  const p = parts.find((x) => x.id === id)!;
  return { source: "catalog", id: p.id, name: p.name, material: p.material, mass_kg: p.mass_kg, dimensions_mm: p.dimensions_mm, model: p.model };
}

const widget: DesignFilePart = {
  source: "custom",
  id: "widget_v2",
  name: "Gear housing",
  mass_kg: 12.5,
  dimensions_mm: [412.3, 288.1, 140.6],
  model: "widget_v2.glb",
};

function designFile(part: DesignFilePart, settings: CrateSettings = DEFAULT_SETTINGS, savedAt = "2026-11-16T12:00:00.000Z"): DesignFile {
  const design = computeDesign(part, settings).design!;
  const r = parseDesignFile(serializeDesign({ part, settings, layoutKey: design.layout.key, design, savedAt }));
  if (!r.ok) throw new Error(r.error);
  return r.file;
}

function entry(part: DesignFilePart, id: string, savedAt: string, name = `Design ${id}`): SavedDesign {
  const r = createEntry({ id, name, notes: "", savedAt, design: designFile(part) });
  if (!r.ok) throw new Error(r.error);
  return r.entry;
}

describe("partKey", () => {
  it("keys a catalog part by id and model", () => {
    expect(partKey(catalogFilePart("PART-001"))).toBe("catalog:PART-001:PART-001-machined-steel-bracket.glb");
  });

  it("keys a custom part by model file name and rounded size", () => {
    expect(partKey(widget)).toBe("custom:widget_v2.glb:412x288x141");
    // Measuring the same file again gives the same key, a different size another one.
    expect(partKey({ ...widget, dimensions_mm: [412.29, 288.14, 140.61] })).toBe(partKey(widget));
    expect(partKey({ ...widget, dimensions_mm: [500, 288.1, 140.6] })).not.toBe(partKey(widget));
    // The custom part's name and mass are editable and not part of its identity.
    const edited: DesignFilePart = { ...widget, name: "Other", mass_kg: 3 };
    expect(partKey(edited)).toBe(partKey(widget));
  });

  it("tells a catalog part from a custom part with the same model", () => {
    const shaft = catalogFilePart("PART-002");
    expect(partKey({ ...shaft, source: "custom" })).not.toBe(partKey(shaft));
  });
});

describe("createEntry and edits", () => {
  it("trims the name and notes and records the part key", () => {
    const r = createEntry({ id: "a", name: "  Bracket x4, export  ", notes: " use 3/4 ply ", savedAt: "2026-11-16T12:00:00.000Z", design: designFile(widget) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry).toMatchObject({ id: "a", name: "Bracket x4, export", notes: "use 3/4 ply", partKey: partKey(widget) });
  });

  it("needs a name", () => {
    const r = createEntry({ id: "a", name: "   ", notes: "", savedAt: "x", design: designFile(widget) });
    expect(r).toEqual({ ok: false, error: "Give the design a name." });
  });

  it("renames, removes and restores at the same place", () => {
    const lib = [entry(widget, "a", "2026-01-01"), entry(widget, "b", "2026-01-02"), entry(widget, "c", "2026-01-03")];
    const renamed = renameEntry(lib, "b", " New name ");
    expect(renamed.ok && renamed.entries[1].name).toBe("New name");
    expect(renameEntry(lib, "b", "").ok).toBe(false);
    expect(renameEntry(lib, "zzz", "x").ok).toBe(false);

    const removed = removeEntry(lib, "b");
    expect(removed?.entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(removed?.removed.id).toBe("b");
    expect(restoreEntry(removed!.entries, removed!.removed, removed!.index).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(removeEntry(lib, "zzz")).toBeNull();
    // Restoring twice doesn't duplicate.
    expect(restoreEntry(lib, lib[1], 1)).toHaveLength(3);
  });
});

describe("entriesForPart", () => {
  it("lists only the part's designs, newest first", () => {
    const bracket = catalogFilePart("PART-001");
    const lib = [entry(bracket, "a", "2026-01-01T00:00:00Z"), entry(widget, "w", "2026-01-05T00:00:00Z"), entry(bracket, "b", "2026-01-03T00:00:00Z")];
    expect(entriesForPart(lib, partKey(bracket)).map((e) => e.id)).toEqual(["b", "a"]);
    expect(entriesForPart(lib, partKey(widget)).map((e) => e.id)).toEqual(["w"]);
    expect(entriesForPart(lib, partKey(catalogFilePart("PART-003")))).toEqual([]);
  });
});

describe("library JSON", () => {
  it("round-trips in a versioned envelope", () => {
    const lib = [entry(widget, "a", "2026-01-01"), entry(catalogFilePart("PART-002"), "b", "2026-01-02")];
    const text = libraryToJson(lib);
    const json = JSON.parse(text);
    expect(json.kind).toBe(LIBRARY_KIND);
    expect(json.version).toBe(LIBRARY_VERSION);
    expect(json.entries).toHaveLength(2);
    // Each entry holds the #28 design file as is.
    expect(json.entries[0].design.kind).toBe("crate-design");
    const r = parseLibrary(text);
    expect(r).toEqual({ ok: true, entries: lib, skipped: [] });
  });

  it.each([
    ["not JSON", "{oops", "not valid JSON"],
    ["another kind", JSON.stringify({ kind: "crate-design", schemaVersion: 1 }), "not a design library"],
    ["a newer version", JSON.stringify({ kind: LIBRARY_KIND, version: LIBRARY_VERSION + 1, entries: [] }), "newer version"],
    ["no entries list", JSON.stringify({ kind: LIBRARY_KIND, version: LIBRARY_VERSION }), "no entries"],
  ])("refuses %s", (_, text, error) => {
    const r = parseLibrary(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(error);
  });

  it("skips bad entries and keeps the good ones", () => {
    const good = entry(widget, "a", "2026-01-01");
    const json = JSON.parse(libraryToJson([good]));
    json.entries.push(
      null,
      { id: "b", name: "", savedAt: "x", design: good.design },
      { id: "c", name: "Bad design", savedAt: "x", design: { ...good.design, settings: { ...good.design.settings, quantity: 0 } } },
      { id: "d", name: "Not a design", savedAt: "x", design: { hello: 1 } },
      { ...good }, // a duplicate id
    );
    const r = parseLibrary(JSON.stringify(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.id)).toEqual(["a"]);
    expect(r.skipped).toHaveLength(5);
    expect(r.skipped[2]).toContain("quantity");
  });

  it("recomputes the part key from the design, so a tampered key can't misfile it", () => {
    const json = JSON.parse(libraryToJson([entry(widget, "a", "2026-01-01")]));
    json.entries[0].partKey = "catalog:PART-001:PART-001-machined-steel-bracket.glb";
    const r = parseLibrary(JSON.stringify(json));
    expect(r.ok && r.entries[0].partKey).toBe(partKey(widget));
  });

  it("merges an import, skipping ids it already has", () => {
    const a = entry(widget, "a", "2026-01-01");
    const b = entry(widget, "b", "2026-01-02");
    const c = entry(widget, "c", "2026-01-03");
    const r = mergeEntries([a, b], [b, c]);
    expect(r.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(1);
  });
});
