import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards } from "@/domain/standards";
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
});
