import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readGlb } from "@/domain/glb";
import { renderMessage } from "./message";
import { checkFiles, type FileCheck, type FileInput } from "./fileCheck";

/** The cog_mm rule of parts.json (#110): three numbers, inside the model's box, in mm in the model's own axes and origin. */

const buffer = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const glb = (path: string): FileInput => ({ name: path.split("/").pop()!, content: buffer(path) });
const catalogOf = (entry: object, top: object = {}): FileInput => ({ name: "parts.json", content: JSON.stringify({ parts: [entry], ...top }) });
const say = (c: FileCheck, code: string) => {
  const f = c.findings.filter((x) => x.code === code);
  expect(f, code).toHaveLength(1);
  return renderMessage(f[0].message, "metric");
};
/** The middle of the model's box in file units, as the file check reads it. */
const centreOf = (path: string) => {
  const r = readGlb(buffer(path));
  if (!("info" in r)) throw new Error("unreadable fixture");
  return r.info.center;
};

describe("parts.json: cog_mm", () => {
  const BASE = { id: "P-1", name: "Part one", model: "a.glb", mass_kg: 12.5 };

  it("is a field the app uses: it is kept and no longer listed as unknown", () => {
    const c = checkFiles([catalogOf({ ...BASE, cog_mm: [10, 20, 30] })]);
    expect(c.entries[0].cog_mm).toEqual([10, 20, 30]);
    expect(c.findings.map((f) => f.code)).not.toContain("unknown-field");
    expect(c.catalogs[0].ignoredFields).toBe(0);
  });

  it.each([
    ["two numbers", [1, 2]],
    ["a string", "10, 20, 30"],
    ["a non-number", [1, "2", 3]],
    ["a list that is too long", [1, 2, 3, 4]],
    ["null", null],
  ])("ignores %s with a warning and says the centre is estimated instead", (_, cog_mm) => {
    const c = checkFiles([catalogOf({ ...BASE, cog_mm })]);
    expect(c.entries).toHaveLength(1);
    expect(c.entries[0].cog_mm).toBeUndefined();
    expect(c.findings.find((f) => f.code === "field-ignored")).toMatchObject({ severity: "warning", where: "parts[0].cog_mm" });
    expect(say(c, "field-ignored")).toMatch(
      /cog_mm should be three numbers, \[x, y, z\] in mm in the model's own axes but is .*, so it was ignored, and the centre of gravity is estimated/,
    );
  });

  it("turns a cog_mm inside the model's box into an offset from the box centre (metres, Z up)", () => {
    const path = "fixtures/units-axis/bracket-metres.glb";
    const [cx, cy, cz] = centreOf(path).map((v) => v * 1000);
    const c = checkFiles([glb(path), catalogOf({ ...BASE, model: "bracket-metres.glb", cog_mm: [cx + 30, cy, cz - 12.5] })]);
    expect(c.opened?.cog).toEqual([30, 0, -12.5]);
    expect(c.findings.map((f) => f.code)).not.toContain("cog-outside");
  });

  it("reads cog_mm as mm even when the file's numbers are inches (model_units)", () => {
    const path = "fixtures/units-axis/bracket-inches.glb";
    const [cx, cy, cz] = centreOf(path).map((v) => v * 25.4);
    const c = checkFiles([glb(path), catalogOf({ ...BASE, model: "bracket-inches.glb", model_units: "in", cog_mm: [cx - 40, cy + 5, cz] })]);
    expect(c.opened?.frame).toEqual({ units: "in", up: "z" });
    expect(c.opened?.cog?.map((v) => Math.round(v * 100) / 100)).toEqual([-40, 5, 0]);
  });

  it("turns a cog_mm of a Y-up file into the Z-up design frame", () => {
    const path = "fixtures/units-axis/bracket-y-up.glb";
    const [cx, cy, cz] = centreOf(path).map((v) => v * 1000);
    // 30 mm along file +X, 20 mm up (file +Y), 10 mm along file +Z: in the design frame (x, -z, y) = (30, -10, 20).
    const c = checkFiles([glb(path), catalogOf({ ...BASE, model: "bracket-y-up.glb", dimensions_mm: [360, 220, 258], cog_mm: [cx + 30, cy + 20, cz + 10] })]);
    expect(c.opened?.frame).toEqual({ units: "m", up: "y" });
    expect(c.opened?.cog?.map((v) => Math.round(v * 100) / 100)).toEqual([30, -10, 20]);
  });

  it("follows a model that sits far from its origin (the point is in the file's own origin)", () => {
    const path = "fixtures/units-axis/bracket-off-origin.glb";
    const [cx, cy, cz] = centreOf(path).map((v) => v * 1000);
    const c = checkFiles([glb(path), catalogOf({ ...BASE, model: "bracket-off-origin.glb", cog_mm: [cx - 50, cy, cz + 20] })]);
    const [x, y, z] = c.opened!.cog!;
    expect([Math.round(x), Math.round(y), Math.round(z)]).toEqual([-50, 0, 20]);
  });

  it("warns for a centre outside the model's box and leaves it out", () => {
    const path = "fixtures/units-axis/bracket-metres.glb";
    const [cx, cy, cz] = centreOf(path).map((v) => v * 1000);
    const c = checkFiles([glb(path), catalogOf({ ...BASE, model: "bracket-metres.glb", cog_mm: [cx + 500, cy, cz] })]);
    expect(c.opened?.cog).toBeUndefined();
    expect(c.findings.find((f) => f.code === "cog-outside")).toMatchObject({ severity: "warning", where: "P-1.cog_mm" });
    expect(say(c, "cog-outside")).toMatch(
      /^P-1: cog_mm \[.*\] is outside the model's box, so it was ignored and the centre of gravity is estimated from the model\. cog_mm is in mm/,
    );
  });
});
