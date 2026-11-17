import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards } from "@/domain/standards";
import { editUnit } from "@/lib/units";
import { plywoodText } from "@/lib/lumber";
import { STANDARD_GROUPS, readStandard, standardPatch } from "./standardsFields";

const fields = STANDARD_GROUPS.flatMap((g) => g.fields);

describe("the editable standards table", () => {
  it("has no path twice", () => {
    const keys = fields.map((f) => f.path.join("."));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(fields.map((f) => [f.path.join("."), f] as const))("%s resolves to a number in the defaults", (_, f) => {
    expect(typeof readStandard(DEFAULT_STANDARDS, f.path)).toBe("number");
  });

  it("writes back the value it reads, through the schema", () => {
    for (const f of fields) {
      const v = readStandard(DEFAULT_STANDARDS, f.path);
      const merged = mergeStandards(DEFAULT_STANDARDS, standardPatch(f.path, v));
      expect(parseStandards(merged).ok, f.path.join(".")).toBe(true);
    }
  });

  it("keeps ticket numbers and spec section marks out of the text people read", () => {
    for (const f of fields) expect(`${f.label} ${f.hint ?? ""}`).not.toMatch(/#\d|§/);
  });

  it("gives every length, mass, density and cost a dimension, and no other field one", () => {
    const expected = { mm: ["length", "lumber", "plywood"], kg: ["mass"], "kg/m³": ["density"], "$/m³": ["cost"] } as Record<string, string[]>;
    for (const f of fields) {
      const allowed = expected[f.unit];
      if (allowed) expect(allowed, f.path.join(".")).toContain(f.dim);
      else expect(f.dim, f.path.join(".")).toBeUndefined();
    }
  });

  it("shows every default in imperial and stores back a value the schema accepts and shows the same", () => {
    for (const f of fields) {
      const u = editUnit(f.dim, "imperial");
      const shown = u.show(readStandard(DEFAULT_STANDARDS, f.path));
      const merged = mergeStandards(DEFAULT_STANDARDS, standardPatch(f.path, u.store(shown)));
      expect(parseStandards(merged).ok, f.path.join(".")).toBe(true);
      expect(u.show(u.store(shown)), f.path.join(".")).toBe(shown);
    }
  });

  it("reads the shipped plywood as the names the rest of the app uses", () => {
    const ply = fields.filter((f) => f.dim === "plywood");
    const names = ply.map((f) => plywoodText(readStandard(DEFAULT_STANDARDS, f.path)));
    const inches = ply.map((f) => editUnit("plywood", "imperial").show(readStandard(DEFAULT_STANDARDS, f.path)));
    expect(names).toEqual(["3/4″", "1/2″", "5/8″", "3/4″"]);
    expect(inches).toEqual([0.75, 0.5, 0.625, 0.75]);
  });

  it("marks the fields where an empty box means zero", () => {
    expect(fields.filter((f) => f.zero).map((f) => f.path.join("."))).toEqual(["limits.perCrate.maxParts", "structure.lidStackKg"]);
  });
});
