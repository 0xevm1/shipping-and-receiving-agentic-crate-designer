import { describe, expect, it } from "vitest";
import { hasKind, readEnvelope, writeEnvelope, type EnvelopeFormat } from "./envelope";

const format: EnvelopeFormat = {
  kind: "thing",
  version: 3,
  label: "thing file",
  what: "a thing",
  migrations: {
    1: (doc) => ({ ...doc, a: 1 }),
    2: (doc) => ({ ...doc, b: 2 }),
  },
};

const text = (o: unknown) => JSON.stringify(o);

describe("readEnvelope", () => {
  it("reads a current document as it is", () => {
    expect(readEnvelope(text({ kind: "thing", version: 3, x: 1 }), format)).toEqual({ ok: true, doc: { kind: "thing", version: 3, x: 1 } });
  });

  it("runs every migration from the file's version up", () => {
    expect(readEnvelope(text({ kind: "thing", version: 1 }), format)).toEqual({ ok: true, doc: { kind: "thing", version: 3, a: 1, b: 2 } });
    expect(readEnvelope(text({ kind: "thing", version: 2 }), format)).toEqual({ ok: true, doc: { kind: "thing", version: 3, b: 2 } });
  });

  it("says why it cannot read, in the document's own words", () => {
    const err = (t: string, f = format) => (readEnvelope(t, f) as { ok: false; error: string }).error;
    expect(err("{oops")).toBe("This thing file is not valid JSON.");
    expect(err(text([]))).toBe("This file is not a thing.");
    expect(err(text({ kind: "other", version: 1 }))).toBe("This file is not a thing.");
    expect(err(text({ kind: "thing" }))).toBe("This thing file has no valid version.");
    expect(err(text({ kind: "thing", version: 1.5 }))).toBe("This thing file has no valid version.");
    expect(err(text({ kind: "thing", version: 0 }))).toBe("This thing file has no valid version.");
    expect(err(text({ kind: "thing", version: 4 }))).toBe("This thing file was saved by a newer version of the app (format 4; this app reads up to 3). Update the app to open it.");
    expect(err(text({ kind: "thing", version: 1 }), { ...format, migrations: {} })).toBe("This thing file format 1 can no longer be read.");
  });

  it("can name the version field differently", () => {
    const f = { ...format, versionKey: "schemaVersion", migrations: {} };
    expect(readEnvelope(text({ kind: "thing", schemaVersion: 3 }), f).ok).toBe(true);
    expect(readEnvelope(text({ kind: "thing", version: 3 }), f)).toEqual({ ok: false, error: "This thing file has no valid schemaVersion." });
  });
});

describe("writeEnvelope and hasKind", () => {
  it("writes pretty JSON ending in a newline", () => {
    expect(writeEnvelope({ kind: "thing", version: 1 })).toBe('{\n  "kind": "thing",\n  "version": 1\n}\n');
  });

  it("tells a kind from other JSON", () => {
    expect(hasKind({ kind: "thing" }, "thing")).toBe(true);
    expect(hasKind({ kind: "other" }, "thing")).toBe(false);
    expect(hasKind([], "thing")).toBe(false);
    expect(hasKind(null, "thing")).toBe(false);
  });
});
