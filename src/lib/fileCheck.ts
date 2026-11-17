import { isDesignFileJson, parseDesignFile } from "@/domain/designFile";
import { MAX_PART_MM } from "@/domain/design";
import { dimsMessage, kg, mm, msg, parts, type Message } from "@/domain/message";
import type { CatalogEntry, Vec3 } from "@/domain/schema";
import { GLB_MESSAGES, glbProblemMessage, readGlb } from "@/domain/glb";
import { cogInsideBox } from "@/domain/cog";
import { cogFromFile, fitFrame, framedSizeMm, guessUnits, UNITS_LABEL, type ModelUnits, type PartFrame } from "./partFrame";

/**
 * The file check (#106): one pure function that reads everything the user picked or dropped and says
 * what is wrong with it, and the decisions the loader then follows (which entries are accepted, which
 * .glb opens and how it is read), so the report and the behaviour cannot disagree. It needs no WebGL
 * and no DOM: the files are names and contents, and it runs in vitest and could run in a CLI.
 * The rules are a table in spec §6.6; each finding has a stable `code` that the tests pin.
 */

/** error: can't be used. warning: used, but look. note: ignored or assumed. */
export type Severity = "error" | "warning" | "note";

export interface Finding {
  /** The file name as it was picked. */
  file: string;
  /** An entry id or a path inside the file, like `parts[2].mass_kg`. Absent for a finding about the whole file. */
  where?: string;
  severity: Severity;
  /** A stable id, for tests and for the spec's table. */
  code: string;
  /** One plain sentence: what is wrong, and what to do. Lengths and masses are data so the units toggle reaches them. */
  message: Message;
}

/** A file as the validator reads it: JSON as text, a .glb as bytes. Other files only need a name. */
export interface FileInput {
  name: string;
  content: string | ArrayBuffer;
}

// --- Limits (spec §6.6). A value outside them is a warning, not an error: the app still uses it. ---

/**
 * The heaviest single part the app takes as believable, in kg. A full trailer carries about 20 t, so
 * one part above that is far more often a mistyped digit or a gram value than a real part (#122). The
 * mass field in the header and an entry in parts.json use this one limit, so they agree.
 */
export const MAX_PLAUSIBLE_MASS_KG = 20_000;
/** The lightest part taken as believable: 1 g. Below it the mass is probably in the wrong unit. */
export const MIN_PLAUSIBLE_MASS_KG = 0.001;
/** Densities in kg/m3 from a light foam to osmium (22,590). Outside is a typo or the wrong unit. */
const PLAUSIBLE_DENSITY_KG_M3: readonly [number, number] = [1, 25_000];
/** A side in mm: 1 mm up to the longest part the app will crate (`MAX_PART_MM`). */
const PLAUSIBLE_SIDE_MM: readonly [number, number] = [1, MAX_PART_MM];
/**
 * A model whose centre is this far from its origin (in mm, after the units are applied) loses
 * precision: float32 holds about 7 digits, so at 100 m the size is off by about 0.01 mm, which is
 * the resolution the app keeps. Nearer than that it does not matter, so nothing is said.
 */
const FAR_FROM_ORIGIN_MM = 100_000;
/** A smallest side under this share of the largest is a sliver: nearly flat, and likely not what was meant. */
const SLIVER_RATIO = 0.001;
/** A measured model size this close to the entry's `dimensions_mm` (mm, per side) is the same size. */
export const MODEL_TOLERANCE_MM = 1;
/** The newest parts.json `schema_version` this app reads. */
const KNOWN_SCHEMA = { major: 1, minor: 0 };

/** Whether a measured size matches an expected one within the tolerance (the model check and the file check agree). */
export const sizeMatches = (measured: readonly number[], expected: readonly number[]): boolean =>
  measured.every((v, i) => Math.abs(v - expected[i]) <= MODEL_TOLERANCE_MM);

/**
 * A warning for a mass the app will take but not believe, or null. `shown` is how the sentence names the
 * mass: the quantity itself by default (it follows the units toggle: the header's mass field and the
 * Checks tab), or the file's own number as written, for a parts.json entry (unit-free).
 */
export function massWarning(massKg: number, shown: string | Message = [kg(massKg)]): Message | null {
  if (massKg > MAX_PLAUSIBLE_MASS_KG) {
    return msg`${shown} is more than ${kg(MAX_PLAUSIBLE_MASS_KG)}, the most one part is taken to weigh. Check for an extra digit or the wrong unit.`;
  }
  if (massKg < MIN_PLAUSIBLE_MASS_KG) return msg`${shown} is under 1 g. Check the mass is in kilograms, not grams.`;
  return null;
}

/** What the loader needs from the check. */
interface OpenedGlb {
  name: string;
  /** The model's size as the file has it (file units, file axes). */
  raw: Vec3;
  /** The frame it is read in. */
  frame: PartFrame;
  /** The units are the app's guess from the size, not given by parts.json or confirmed by a catalog size. */
  guessed: boolean;
  /** The entry that names this file, when one does. */
  entry?: CatalogEntry;
  /**
   * The entry's `cog_mm` as an offset from the middle of the model's box in the design frame (mm, Z up),
   * when it has one that lies inside the box (#110). Converted here, once, so nothing after knows the file's origin.
   */
  cog?: Vec3;
}

/** One parts.json's outcome, for the one-line verdict. */
interface CatalogSummary {
  file: string;
  accepted: number;
  /** Skipped entries: who they are and which fields were wrong. */
  skipped: { label: string; fields: string[]; model?: string }[];
  /** Fields that were unknown or unusable and left out. */
  ignoredFields: number;
}

export interface FileCheck {
  findings: Finding[];
  /** The entries that passed, from every parts.json supplied. The loader adds them to the catalog. */
  entries: CatalogEntry[];
  catalogs: CatalogSummary[];
  /** A saved design file among the files (its own parser says whether it is good). */
  design: { file: string; text: string } | null;
  /** The model that opens as the part; null when none can. */
  opened: OpenedGlb | null;
  /** True when a parts.json had usable entries and no .glb was supplied: the part is still to be chosen. */
  awaitingGlb: boolean;
}

export interface CheckOptions {
  /** Entries already known (the bundled catalog and earlier loads): a .glb named like one needs no parts.json. */
  known?: readonly CatalogEntry[];
}

const t = (s: string): Message => [s];
const ext = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1].toLowerCase() ?? "";
const quote = (s: string) => `"${s}"`;

/** A short look at a value for a message: `"12 kg"`, `-5`, `a list`, `null`. */
function show(v: unknown): string {
  if (typeof v === "string") return v.length > 24 ? `${quote(v.slice(0, 24))}…` : quote(v);
  if (Array.isArray(v)) return "a list";
  if (v !== null && typeof v === "object") return "an object";
  return String(v);
}

/** Where the first syntax error of a JSON text is, found by reading it. The engines word their errors differently, and most give no position. */
function syntaxError(text: string): { index: number; found: string | null } {
  let i = 0;
  const fail = (at = i): never => {
    throw Object.assign(new Error("JSON syntax"), { index: at });
  };
  const skip = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const string = () => {
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') return void i++;
      if (c < " ") fail();
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u" ? !/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6)) : !e || !'"\\/bfnrt'.includes(e)) fail(i + 1);
        i += e === "u" ? 6 : 2;
      } else i++;
    }
    fail(text.length);
  };
  const value = (depth: number) => {
    skip();
    const c = text[i];
    if (depth > 200) fail();
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      skip();
      if (text[i] === close) return void i++;
      for (;;) {
        skip();
        if (c === "{") {
          if (text[i] !== '"') fail();
          string();
          skip();
          if (text[i] !== ":") fail();
          i++;
        }
        value(depth + 1);
        skip();
        if (text[i] === ",") i++;
        else if (text[i] === close) return void i++;
        else fail();
      }
    } else if (c === '"') string();
    else if (c === "-" || (c >= "0" && c <= "9")) {
      const m = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
      m.lastIndex = i;
      const r = m.exec(text);
      if (!r) fail(i + 1);
      else i += r[0].length;
    } else {
      const literal = ["true", "false", "null"].find((l) => text.startsWith(l, i));
      if (!literal) fail();
      else i += literal.length;
    }
  };
  try {
    value(0);
    skip();
    if (i < text.length) fail();
  } catch (e) {
    const index = (e as { index?: number }).index ?? 0;
    return { index, found: index < text.length ? text[index] : null };
  }
  return { index: 0, found: null };
}

/** "line 3, column 5" for an index in a text. */
function lineColumn(text: string, index: number): string {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return `line ${line}, column ${index - before.lastIndexOf("\n")}`;
}

/** The units a `model_units` value names (`meters`, `mm`, `inches` and the obvious spellings), or null. */
export function parseModelUnits(value: unknown): ModelUnits | null {
  if (typeof value !== "string") return null;
  const v = value
    .trim()
    .toLowerCase()
    .replace(/[.\s_-]+/g, "");
  if (["m", "meter", "meters", "metre", "metres"].includes(v)) return "m";
  if (["mm", "millimeter", "millimeters", "millimetre", "millimetres"].includes(v)) return "mm";
  if (["in", "inch", "inches", '"'].includes(v)) return "in";
  return null;
}

const ENTRY_FIELDS = ["id", "name", "model", "material", "density_kg_m3", "mass_kg", "dimensions_mm", "cog_mm", "suggested_quantities", "model_units"];
const TOP_FIELDS = ["schema_version", "coordinate_system", "model_units", "metadata_note", "parts"];

/** What each required field is, for the "should be" half of a message. */
const REQUIRED = {
  id: { has: "an id", fix: 'Give it a unique id, like "PART-004"' },
  name: { has: "a name", fix: "Give it a name" },
  model: { has: "a model", fix: 'Name its file, like "bracket.glb"' },
  mass_kg: { has: "a mass_kg", fix: "Add the mass of one part in kilograms, like 12.5" },
} as const;

interface Catalog {
  summary: CatalogSummary;
  entries: CatalogEntry[];
}

/** Checks one parts.json: the whole file, then each entry. */
function checkCatalog(file: string, json: unknown, out: Finding[]): Catalog {
  const summary: CatalogSummary = { file, accepted: 0, skipped: [], ignoredFields: 0 };
  const add = (severity: Severity, code: string, message: Message, where?: string) => out.push({ file, where, severity, code, message });
  const ignored = (code: string, message: Message, where: string) => {
    summary.ignoredFields++;
    add("note", code, message, where);
  };

  const top = json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const list = top?.parts;
  if (!top || !Array.isArray(list)) {
    const found = Array.isArray(json)
      ? "a list of parts with no wrapper"
      : top
        ? `only ${Object.keys(top).slice(0, 4).map(quote).join(", ") || "an empty object"}`
        : show(json);
    add("error", "shape", t(`Expected an object with a "parts" list, like {"parts": [ … ]}, but found ${found}. Wrap the part entries in a "parts" list.`));
    return { summary, entries: [] };
  }
  if (list.length === 0) {
    add("error", "shape", t('The "parts" list is empty. Add at least one part entry.'), "parts");
    return { summary, entries: [] };
  }

  // The file as a whole.
  const version = top.schema_version;
  const match = typeof version === "string" || typeof version === "number" ? /^(\d+)(?:\.(\d+))?/.exec(String(version).trim()) : null;
  if (match && (Number(match[1]) > KNOWN_SCHEMA.major || (Number(match[1]) === KNOWN_SCHEMA.major && Number(match[2] ?? 0) > KNOWN_SCHEMA.minor))) {
    add(
      "warning",
      "schema-newer",
      t(
        `schema_version ${version} is newer than the ${KNOWN_SCHEMA.major}.${KNOWN_SCHEMA.minor} this app reads, so fields added since are ignored. Check the entries below look right.`,
      ),
      "schema_version",
    );
  }
  let fileUnits: ModelUnits | undefined;
  if (top.model_units !== undefined) {
    fileUnits = parseModelUnits(top.model_units) ?? undefined;
    if (!fileUnits) {
      add(
        "warning",
        "units-unknown",
        t(
          `model_units ${show(top.model_units)} isn't meters, millimeters or inches, so the units are guessed from each model's size. Set it to one of those three.`,
        ),
        "model_units",
      );
    }
  }
  for (const key of Object.keys(top).filter((k) => !TOP_FIELDS.includes(k))) {
    ignored("unknown-field", t(`${quote(key)} isn't a field the app uses, so it was ignored.`), key);
  }

  const entries: CatalogEntry[] = [];
  const ids = new Map<string, number>();
  const models = new Map<string, number>();
  list.forEach((raw, i) => {
    const at = `parts[${i}]`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      summary.skipped.push({ label: `Entry ${i + 1}`, fields: [] });
      add(
        "error",
        "entry-shape",
        t(`Entry ${i + 1} is ${show(raw)}, not an object with an id, name, model and mass_kg, so it was skipped. Replace it with an object like the others.`),
        at,
      );
      return;
    }
    const e = raw as Record<string, unknown>;
    const label = typeof e.id === "string" && e.id.trim() ? e.id.trim() : typeof e.name === "string" && e.name.trim() ? e.name.trim() : `Entry ${i + 1}`;
    const bad: string[] = [];
    const skip = (code: string, field: string, message: string) => {
      bad.push(field);
      add("error", code, t(message), `${at}.${field}`);
    };

    // Required fields: missing, or the wrong kind of value, means the entry can't be used.
    for (const field of ["id", "name", "model"] as const) {
      const v = e[field];
      const r = REQUIRED[field];
      if (v === undefined || v === null) skip("missing-field", field, `${label} has no ${field}, so it was skipped. ${r.fix}.`);
      else if (typeof v !== "string" || !v.trim())
        skip("wrong-type", field, `${label}: ${field} should be text but is ${typeof v === "string" ? "empty" : show(v)}, so it was skipped. ${r.fix}.`);
      else if (field === "model" && ext(v) !== "glb") {
        skip(
          "wrong-type",
          field,
          `${label}: model ${quote(v)} isn't a .glb file name, so it was skipped. The app opens .glb files only: export the part as .glb and name that file.`,
        );
      }
    }
    const mass = e.mass_kg;
    if (mass === undefined || mass === null) skip("missing-field", "mass_kg", `${label} has no mass_kg, so it was skipped. ${REQUIRED.mass_kg.fix}.`);
    else if (typeof mass !== "number") {
      const numeric = typeof mass === "string" && Number.isFinite(Number.parseFloat(mass));
      skip(
        "wrong-type",
        "mass_kg",
        `${label}: mass_kg should be a number but is ${show(mass)}, so it was skipped. ${numeric ? "Write just the number of kilograms, without quotes or a unit" : REQUIRED.mass_kg.fix}.`,
      );
    } else if (!(mass > 0) || !Number.isFinite(mass)) {
      skip(
        "non-positive",
        "mass_kg",
        `${label}: mass_kg is ${mass}, but a part must weigh more than 0 kg, so it was skipped. Enter its real mass in kilograms.`,
      );
    }

    // Repeats: the first entry with an id, or a model file, is the one that counts.
    const id = typeof e.id === "string" ? e.id.trim() : "";
    if (id && ids.has(id)) skip("duplicate-id", "id", `${label} repeats the id of parts[${ids.get(id)}], so it was skipped. Give every part its own id.`);
    const model = typeof e.model === "string" ? e.model.trim() : "";
    if (model && ext(model) === "glb" && models.has(model) && !bad.includes("id")) {
      skip(
        "duplicate-model",
        "model",
        `${label} names ${model}, which parts[${models.get(model)}] already uses, so it was skipped. Each part needs its own .glb.`,
      );
    }
    if (bad.length) {
      summary.skipped.push({ label, fields: bad, model: typeof e.model === "string" ? e.model.trim() : undefined });
      return;
    }
    ids.set(id, i);
    models.set(model, i);

    const entry: CatalogEntry = { id, name: (e.name as string).trim(), model, mass_kg: mass as number };
    const optional = (field: string, should: string, fallback: string) => {
      summary.ignoredFields++;
      add("warning", "field-ignored", t(`${label}: ${field} should be ${should} but is ${show(e[field])}, so it was ignored${fallback}.`), `${at}.${field}`);
    };
    if (e.material !== undefined) {
      if (typeof e.material === "string") entry.material = e.material;
      else optional("material", "text", "");
    }
    if (e.density_kg_m3 !== undefined) {
      const d = e.density_kg_m3;
      if (typeof d === "number" && d > 0 && Number.isFinite(d)) {
        entry.density_kg_m3 = d;
        if (d < PLAUSIBLE_DENSITY_KG_M3[0] || d > PLAUSIBLE_DENSITY_KG_M3[1]) {
          add(
            "warning",
            "implausible-density",
            t(
              `${label}: density_kg_m3 is ${d}, outside ${PLAUSIBLE_DENSITY_KG_M3[0]} to ${PLAUSIBLE_DENSITY_KG_M3[1].toLocaleString("en-US")}. Check it is in kilograms per cubic metre.`,
            ),
            `${at}.density_kg_m3`,
          );
        }
      } else optional("density_kg_m3", "a number above 0", "");
    }
    if (e.dimensions_mm !== undefined) {
      const d = e.dimensions_mm;
      if (Array.isArray(d) && d.length === 3 && d.every((v) => typeof v === "number" && v > 0 && Number.isFinite(v))) {
        entry.dimensions_mm = d as Vec3;
        const odd = (d as number[]).filter((v) => v < PLAUSIBLE_SIDE_MM[0] || v > PLAUSIBLE_SIDE_MM[1]);
        if (odd.length) {
          add(
            "warning",
            "implausible-dimension",
            msg`${label}: dimensions_mm has ${String(odd[0])}, outside ${mm(PLAUSIBLE_SIDE_MM[0])} to ${mm(PLAUSIBLE_SIDE_MM[1])}. Check it is in millimetres.`,
            `${at}.dimensions_mm`,
          );
        }
      } else optional("dimensions_mm", "three numbers above 0, [x, y, z] in mm", ", and the size comes from the model");
    }
    if (e.cog_mm !== undefined) {
      const c = e.cog_mm;
      if (Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === "number" && Number.isFinite(v))) entry.cog_mm = c as Vec3;
      else optional("cog_mm", "three numbers, [x, y, z] in mm in the model's own axes", ", and the centre of gravity is estimated from the model");
    }
    if (e.suggested_quantities !== undefined) {
      const q = e.suggested_quantities;
      if (Array.isArray(q) && q.length > 0 && q.every((v) => Number.isInteger(v) && v > 0)) entry.suggested_quantities = q as number[];
      else optional("suggested_quantities", "a list of whole numbers above 0", ", and 1, 4 and 8 are suggested");
    }
    if (e.model_units !== undefined) {
      const u = parseModelUnits(e.model_units);
      if (u) entry.model_units = u;
      else {
        add(
          "warning",
          "units-unknown",
          t(
            `${label}: model_units ${show(e.model_units)} isn't meters, millimeters or inches, so the units are ${fileUnits ? "the file's" : "guessed from the model's size"}. Set it to one of those three.`,
          ),
          `${at}.model_units`,
        );
      }
    }
    if (!entry.model_units && fileUnits) entry.model_units = fileUnits;
    if (entry.mass_kg > MAX_PLAUSIBLE_MASS_KG || entry.mass_kg < MIN_PLAUSIBLE_MASS_KG) {
      add("warning", "implausible-mass", parts(`${label}: `, massWarning(entry.mass_kg, `a mass_kg of ${entry.mass_kg}`)!), `${at}.mass_kg`);
    }
    for (const key of Object.keys(e).filter((k) => !ENTRY_FIELDS.includes(k))) {
      ignored("unknown-field", t(`${label} has a field ${quote(key)} that the app doesn't use, so it was ignored.`), `${at}.${key}`);
    }
    entries.push(entry);
    summary.accepted++;
  });
  return { summary, entries };
}

/** Reads the picked files. Pure: see the module comment. */
export function checkFiles(files: readonly FileInput[], { known = [] }: CheckOptions = {}): FileCheck {
  const findings: Finding[] = [];
  const catalogs: Catalog[] = [];
  let design: FileCheck["design"] = null;
  let designModel: string | null = null;
  const glbs: { name: string; ok: boolean; raw?: Vec3; center?: Vec3 }[] = [];
  const unusable: string[] = [];

  for (const f of files) {
    const kind = ext(f.name);
    const add = (severity: Severity, code: string, message: Message, where?: string) => findings.push({ file: f.name, where, severity, code, message });
    if (kind === "json") {
      const text = (typeof f.content === "string" ? f.content : new TextDecoder().decode(f.content)).replace(/^\uFEFF/, "");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        const { index, found } = syntaxError(text);
        const where = lineColumn(text, index);
        add(
          "error",
          "json-syntax",
          t(
            `This isn't valid JSON: ${found === null ? "the file ends before the JSON is complete" : `unexpected ${quote(found === "\n" ? "line break" : found)}`} at ${where}. Fix that and load it again.`,
          ),
        );
        continue;
      }
      if (isDesignFileJson(json)) {
        design ??= { file: f.name, text };
        const parsed = parseDesignFile(text);
        if (parsed.ok) designModel = parsed.file.part.model;
      } else catalogs.push(checkCatalog(f.name, json, findings));
    } else if (kind === "glb") {
      if (typeof f.content === "string") continue;
      const r = readGlb(f.content);
      if ("problem" in r) {
        add("error", `glb-${r.problem.kind}`, t(glbProblemMessage(r.problem)));
        glbs.push({ name: f.name, ok: false });
      } else glbs.push({ name: f.name, ok: true, raw: r.info.size, center: r.info.center });
    } else if (kind === "gltf") {
      add("error", "gltf-text", t(GLB_MESSAGES.textGltf));
    } else unusable.push(f.name);
  }

  const entries = catalogs.flatMap((c) => c.entries);
  const usable = catalogs.length > 0 || glbs.length > 0 || design !== null || findings.some((x) => x.code === "gltf-text" || x.code === "json-syntax");
  for (const name of unusable) {
    findings.push({
      file: name,
      severity: usable ? "note" : "error",
      code: "file-type",
      message: t(
        `${name} isn't a .glb or a .json file, so it ${usable ? "was ignored" : "can't be used"}. Choose a part as .glb, with a parts.json if you have one, or a saved design .json.`,
      ),
    });
  }

  // Which model opens. A saved design names its own; otherwise one that an entry names comes first, then the first that is readable.
  const readable = glbs.filter((g) => g.ok);
  const everyEntry = [...entries, ...known];
  const named = (g: { name: string }) => everyEntry.find((p) => p.model === g.name);
  let pick: (typeof readable)[number] | undefined;
  if (design) pick = readable.find((g) => g.name === designModel) ?? (readable.length === 1 ? readable[0] : undefined);
  else pick = readable.find(named) ?? readable[0];

  let opened: OpenedGlb | null = null;
  if (pick && !design) {
    const entry = named(pick);
    const raw = pick.raw!;
    const add = (severity: Severity, code: string, message: Message, where?: string) => findings.push({ file: pick.name, where, severity, code, message });
    const chosen = chooseFrame(raw, entry);
    opened = { name: pick.name, raw, frame: chosen.frame, guessed: chosen.guessed, entry };
    if (chosen.disagrees) {
      add(
        "warning",
        "units-disagree",
        t(
          `model_units says ${UNITS_LABEL[chosen.disagrees]}, but the model only matches dimensions_mm read as ${UNITS_LABEL[chosen.frame.units]}, so it was read that way. Correct model_units in parts.json.`,
        ),
        entry?.id,
      );
    }
    const size = framedSizeMm(raw, chosen.frame);
    if (entry?.dimensions_mm && !sizeMatches(size, entry.dimensions_mm)) {
      add(
        "warning",
        "size-mismatch",
        msg`The model measures ${dimsMessage(size.map(Math.round))} but ${entry.id} says ${dimsMessage(entry.dimensions_mm)}. Check dimensions_mm and model_units, or the file's units under the part's size at the top left.`,
        entry.id,
      );
    }
    if (chosen.guessed && chosen.frame.units !== "m") {
      add(
        "note",
        "units-guessed",
        t(
          `The model's units aren't given, so it is read as ${UNITS_LABEL[chosen.frame.units]} from its size. If that is wrong, set the file's units at the top left, or give model_units in parts.json.`,
        ),
      );
    }
    if (entry?.cog_mm) {
      const cog = cogFromFile(entry.cog_mm, pick.center!, chosen.frame);
      if (cogInsideBox(cog, size)) opened.cog = cog;
      else {
        add(
          "warning",
          "cog-outside",
          t(
            `${entry.id}: cog_mm [${entry.cog_mm.join(", ")}] is outside the model's box, so it was ignored and the centre of gravity is estimated from the model. cog_mm is in mm, in the model's own axes and origin (model_units says how the file's numbers are read).`,
          ),
          `${entry.id}.cog_mm`,
        );
      }
    }
    const sorted = [...size].sort((a, b) => a - b);
    if (sorted[0] < sorted[2] * SLIVER_RATIO) {
      add(
        "warning",
        "glb-sliver",
        t(
          `Its thinnest side is ${Number(((sorted[0] / sorted[2]) * 100).toPrecision(1))}% of its longest, so it is almost flat. If that isn't the part, check the export.`,
        ),
      );
    }
    const k = chosen.frame.units === "m" ? 1000 : chosen.frame.units === "in" ? 25.4 : 1;
    const away = Math.hypot(...pick.center!) * k;
    if (away > FAR_FROM_ORIGIN_MM) {
      add(
        "note",
        "glb-off-origin",
        msg`Its geometry sits about ${mm(away)} from the file's origin, where sizes lose precision (about 0.01 mm). Move the part to the origin before exporting.`,
      );
    }
  }
  for (const g of readable) {
    if (design || g === pick) continue;
    findings.push({
      file: g.name,
      severity: "note",
      code: "glb-extra",
      message: t(`Not opened: the app designs one part at a time, and it opened ${pick!.name}. Load this file on its own to design it.`),
    });
  }

  // parts.json entries and the files they name. Said only when no .glb that was supplied is named by an entry: with a
  // catalog beside one model, the entries for the other parts are the catalog doing its job, not a mistake.
  if (!design && glbs.length > 0 && catalogs.length > 0 && !glbs.some(named)) {
    const skippedFor = (name: string) => catalogs.flatMap((c) => c.summary.skipped).find((x) => x.model === name);
    // A skipped entry that names a supplied file is the reason, and already has its own finding.
    if (!glbs.some((g) => skippedFor(g.name))) {
      for (const c of catalogs) {
        for (const e of c.entries) {
          findings.push({
            file: c.summary.file,
            where: e.id,
            severity: "warning",
            code: "model-missing",
            message: t(`${e.id} names ${e.model}, which wasn't loaded. Load that .glb with parts.json, or fix the name.`),
          });
        }
      }
    }
    for (const g of readable) {
      if (g !== pick) continue;
      const skipped = skippedFor(g.name);
      findings.push({
        file: g.name,
        severity: "note",
        code: "glb-unlisted",
        message: t(
          skipped
            ? `Its entry (${skipped.label}) was skipped, so it was loaded with stand-in details (10 kg).`
            : "No entry in parts.json names this file, so it was loaded with stand-in details (10 kg).",
        ),
      });
    }
  }
  const awaitingGlb = !design && glbs.length === 0 && entries.length > 0;

  // Order by the files as they were picked, so the report reads in the order the user chose.
  const order = new Map(files.map((f, i) => [f.name, i]));
  findings.sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0));
  return { findings, entries, catalogs: catalogs.map((c) => c.summary), design, opened, awaitingGlb };
}

/**
 * The frame a model is read in. With an entry that has a size, the frame that reproduces it wins (the
 * entry's `model_units` first, then any), so the size follows the catalog; `disagrees` is set when
 * `model_units` was overridden by that. Otherwise the entry's `model_units`, else the size-based guess.
 */
function chooseFrame(raw: Vec3, entry?: CatalogEntry): { frame: PartFrame; guessed: boolean; disagrees?: ModelUnits } {
  const declared = entry?.model_units;
  const dims = entry?.dimensions_mm;
  if (dims) {
    if (declared) {
      for (const up of ["z", "y"] as const) {
        const frame = { units: declared, up };
        if (sizeMatches(framedSizeMm(raw, frame), dims)) return { frame, guessed: false };
      }
    }
    const fit = fitFrame(raw, dims);
    if (fit) return { frame: fit, guessed: false, disagrees: declared && declared !== fit.units ? declared : undefined };
  }
  if (declared) return { frame: { units: declared, up: "z" }, guessed: false };
  return { frame: { units: guessUnits(Math.max(...raw)), up: "z" }, guessed: true };
}
