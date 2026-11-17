import { z } from "zod";
import { parseDesignFile, type DesignFile, type DesignFilePart } from "./designFile";

/**
 * The design library (#14, spec §9): named designs saved per part, so a repeat part gets the
 * same proven crate in one click. Each entry holds a #28 design file as is, plus a name, notes
 * and when it was saved. The same versioned envelope is stored in localStorage and exported as
 * the library file. Pure: no DOM, no I/O.
 */

export const LIBRARY_KIND = "crate-design-library";
/** Bump when the envelope or entry format changes in a way older readers can't handle. */
export const LIBRARY_VERSION = 1;
export const NAME_MAX = 80;
export const NOTES_MAX = 1000;

export interface SavedDesign {
  id: string;
  name: string;
  notes: string;
  /** ISO timestamp of the save (the design file's own `savedAt` is the same). */
  savedAt: string;
  /** `partKey(design.part)`: which part this design is for. Recomputed on every read. */
  partKey: string;
  design: DesignFile;
}

/**
 * A part's identity in the library.
 * - Catalog part: its id and model (`catalog:PART-001:PART-001-machined-steel-bracket.glb`).
 * - Custom part: its model file name and size, rounded to 1 mm (`custom:widget_v2.glb:412x288x141`).
 *   Name, material and mass are editable and so are not part of the identity.
 */
export function partKey(part: Pick<DesignFilePart, "source" | "id" | "model" | "dimensions_mm">): string {
  if (part.source === "catalog") return `catalog:${part.id}:${part.model}`;
  return `custom:${part.model}:${part.dimensions_mm.map((v) => Math.round(v)).join("x")}`;
}

export type EntryResult = { ok: true; entry: SavedDesign } | { ok: false; error: string };

function cleanName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, " ");
  return n ? n.slice(0, NAME_MAX) : null;
}

const NO_NAME = "Give the design a name.";

/** A new library entry for a design file. The name is required; notes are optional. */
export function createEntry(input: { id: string; name: string; notes?: string; savedAt: string; design: DesignFile }): EntryResult {
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: NO_NAME };
  return {
    ok: true,
    entry: {
      id: input.id,
      name,
      notes: (input.notes ?? "").trim().slice(0, NOTES_MAX),
      savedAt: input.savedAt,
      partKey: partKey(input.design.part),
      design: input.design,
    },
  };
}

export type EditResult = { ok: true; entries: SavedDesign[] } | { ok: false; error: string };

export function renameEntry(entries: SavedDesign[], id: string, name: string): EditResult {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: NO_NAME };
  if (!entries.some((e) => e.id === id)) return { ok: false, error: "That design is no longer saved." };
  return { ok: true, entries: entries.map((e) => (e.id === id ? { ...e, name: clean } : e)) };
}

export interface Removed {
  entries: SavedDesign[];
  removed: SavedDesign;
  /** Where it was, so an undo puts it back in the same place. */
  index: number;
}

export function removeEntry(entries: SavedDesign[], id: string): Removed | null {
  const index = entries.findIndex((e) => e.id === id);
  if (index < 0) return null;
  return { entries: entries.filter((e) => e.id !== id), removed: entries[index], index };
}

/** Puts a removed entry back (undo). Does nothing if it is already there. */
export function restoreEntry(entries: SavedDesign[], entry: SavedDesign, index: number): SavedDesign[] {
  if (entries.some((e) => e.id === entry.id)) return entries;
  const next = [...entries];
  next.splice(Math.min(Math.max(0, index), next.length), 0, entry);
  return next;
}

/** The part's saved designs, newest first. */
export function entriesForPart(entries: SavedDesign[], key: string): SavedDesign[] {
  return entries.filter((e) => e.partKey === key).sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
}

/** Adds imported entries after the existing ones; an id that is already saved is skipped. */
export function mergeEntries(entries: SavedDesign[], incoming: SavedDesign[]) {
  const ids = new Set(entries.map((e) => e.id));
  const added = incoming.filter((e) => !ids.has(e.id) && (ids.add(e.id), true));
  return { entries: [...entries, ...added], added: added.length, duplicates: incoming.length - added.length };
}

/** The library as pretty-printed JSON, ending in a newline. */
export function libraryToJson(entries: SavedDesign[]): string {
  return JSON.stringify({ kind: LIBRARY_KIND, version: LIBRARY_VERSION, entries }, null, 2) + "\n";
}

const EntrySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  notes: z.string().optional(),
  savedAt: z.string().min(1),
  design: z.unknown(),
});

export type LibraryParse =
  | { ok: true; entries: SavedDesign[]; /** One sentence per entry that was left out. */ skipped: string[] }
  | { ok: false; error: string };

/**
 * Reads a library (stored or imported). Never throws. The envelope must be right; then each
 * entry is checked on its own, its design through `parseDesignFile` (so versions and migrations
 * apply), and a bad entry is skipped with a reason rather than losing the rest.
 */
export function parseLibrary(text: string): LibraryParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This library file is not valid JSON." };
  }
  const doc = json as { kind?: unknown; version?: unknown; entries?: unknown } | null;
  if (typeof doc !== "object" || doc === null || doc.kind !== LIBRARY_KIND) {
    return { ok: false, error: "This file is not a design library." };
  }
  if (typeof doc.version !== "number" || !Number.isInteger(doc.version) || doc.version < 1) {
    return { ok: false, error: "This design library has no valid version." };
  }
  if (doc.version > LIBRARY_VERSION) {
    return { ok: false, error: `This design library was saved by a newer version of the app (format ${doc.version}).` };
  }
  if (!Array.isArray(doc.entries)) return { ok: false, error: "This design library has no entries list." };

  const entries: SavedDesign[] = [];
  const skipped: string[] = [];
  const ids = new Set<string>();
  doc.entries.forEach((raw, i) => {
    const where = `Entry ${i + 1}`;
    const r = EntrySchema.safeParse(raw);
    if (!r.success) return skipped.push(`${where}: ${r.error.issues[0].path.join(".") || "entry"}: ${r.error.issues[0].message}.`);
    if (ids.has(r.data.id)) return skipped.push(`${where}: the id ${r.data.id} is used twice.`);
    const parsed = parseDesignFile(JSON.stringify(r.data.design ?? null));
    if (!parsed.ok) return skipped.push(`${where} (${r.data.name || "no name"}): ${parsed.error}`);
    const made = createEntry({ ...r.data, design: parsed.file });
    if (!made.ok) return skipped.push(`${where}: ${made.error}`);
    ids.add(r.data.id);
    entries.push(made.entry);
  });
  return { ok: true, entries, skipped };
}
