import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { nominalLumber } from "./lumber";
import { countKind, memberBounds, sortDesc } from "./members";
import type { Vec3 } from "./schema";
import { designOf, metricText as metric } from "./testFixtures";

describe("countKind", () => {
  it("counts the boards of one kind", () => {
    const boards = [{ kind: "bearer" }, { kind: "blocking" }, { kind: "bearer" }] as const;
    expect(countKind(boards, "bearer")).toBe(2);
    expect(countKind(boards, "cradle")).toBe(0);
  });
});

describe("memberBounds", () => {
  it("spans the smallest and largest corners of the boards", () => {
    const boards: { min: Vec3; size: Vec3 }[] = [
      { min: [0, 0, -50], size: [100, 40, 50] },
      { min: [-10, 5, 0], size: [20, 100, 30] },
    ];
    expect(memberBounds(boards)).toEqual({ min: [-10, 0, -50], max: [100, 105, 30] });
  });

  it("covers every board of a design", () => {
    const d = designOf(getPart("PART-001"));
    const { min, max } = memberBounds(d.members);
    for (const m of d.members) {
      for (let i = 0; i < 3; i++) {
        expect(m.min[i]).toBeGreaterThanOrEqual(min[i]);
        expect(m.min[i] + m.size[i]).toBeLessThanOrEqual(max[i]);
      }
    }
  });
});

describe("sortDesc", () => {
  it("sorts largest first without changing its input", () => {
    const v = [3, 10, 7];
    expect(sortDesc(v)).toEqual([10, 7, 3]);
    expect(v).toEqual([3, 10, 7]);
  });
});

describe("lumber names", () => {
  it("name a section the same in either order, to the nearest mm", () => {
    expect(nominalLumber(89, 140)).toBe("4x6");
    expect(nominalLumber(140, 89)).toBe("4x6");
    expect(nominalLumber(38.4, 88.6)).toBe("2x4");
    expect(nominalLumber(30, 100)).toBeNull();
  });

  it("are used with a plain x in the base-rating check", () => {
    const d = designOf(getPart("PART-001"), { quantity: 40 });
    const text = metric(d.checks.find((c) => c.id === "base-rating")!.detail);
    expect(text).toMatch(/\d+ × \dx\d skids/);
    expect(text).not.toContain("×4");
  });
});
