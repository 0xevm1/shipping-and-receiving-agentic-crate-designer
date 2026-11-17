import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined properties", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("writes numbers in their shortest form, with -0 as 0", () => {
    expect(canonicalJson([0.1 + 0.2, 1e21, -0, 1.5e-7])).toBe("[0.30000000000000004,1e+21,0,1.5e-7]");
  });

  it("writes undefined array items as null and typed arrays as arrays", () => {
    expect(canonicalJson([undefined, new Float32Array([1, 2])])).toBe("[null,[1,2]]");
  });

  it("escapes strings as JSON does", () => {
    expect(canonicalJson({ "k\n": 'a"b×' })).toBe('{"k\\n":"a\\"b×"}');
  });

  it("refuses values with no single JSON form", () => {
    expect(() => canonicalJson({ a: NaN })).toThrow(/\$\.a is NaN/);
    expect(() => canonicalJson([Infinity])).toThrow();
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/function/);
    expect(() => canonicalJson({ m: new Map() })).toThrow(/Map/);
    expect(() => canonicalJson(BigInt(1))).toThrow(/bigint/);
  });
});
