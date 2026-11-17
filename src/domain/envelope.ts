/**
 * The versioned envelope every saved document shares: `{ kind, version, ...payload }`.
 * One reader (JSON → kind → version → migrations → "newer version" error) and one writer
 * (pretty JSON ending in a newline), so the design file, the design library and any other
 * stored format fail the same way. Pure.
 */

export interface EnvelopeFormat {
  /** The `kind` string the document must carry. */
  kind: string;
  /** The version this app writes and reads up to. */
  version: number;
  /** What the document is called in a message: "design file". */
  label: string;
  /** What it is when it is not that: "a crate design" gives "This file is not a crate design." */
  what: string;
  /** The version field's name; "version" unless the format calls it something else. */
  versionKey?: string;
  /** Migrations keyed by the version they read; each returns the next version's shape. */
  migrations?: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>;
}

export type EnvelopeResult = { ok: true; doc: Record<string, unknown> } | { ok: false; error: string };

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True for JSON that claims to be this kind of document. */
export const hasKind = (json: unknown, kind: string): boolean => isPlainObject(json) && json.kind === kind;

/** Reads `text` as an envelope of `format`, migrated to the current version. Never throws. */
export function readEnvelope(text: string, format: EnvelopeFormat): EnvelopeResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `This ${format.label} is not valid JSON.` };
  }
  return readEnvelopeJson(json, format);
}

/** As `readEnvelope`, for JSON that is already parsed. */
export function readEnvelopeJson(json: unknown, format: EnvelopeFormat): EnvelopeResult {
  const { kind, version: current, label, what, versionKey = "version", migrations = {} } = format;
  if (!isPlainObject(json) || json.kind !== kind) return { ok: false, error: `This file is not ${what}.` };
  let doc = json;
  let v = doc[versionKey];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { ok: false, error: `This ${label} has no valid ${versionKey}.` };
  if (v > current) {
    return {
      ok: false,
      error: `This ${label} was saved by a newer version of the app (format ${v}; this app reads up to ${current}). Update the app to open it.`,
    };
  }
  while (v < current) {
    const migrate = migrations[v];
    if (!migrate) return { ok: false, error: `This ${label} format ${v} can no longer be read.` };
    doc = { ...migrate(doc), [versionKey]: v + 1 };
    v += 1;
  }
  return { ok: true, doc };
}

/** A document as pretty-printed JSON, ending in a newline. */
export function writeEnvelope(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
