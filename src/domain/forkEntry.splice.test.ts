import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { FORK_ENTRIES } from "./forkEntry";
import type { Member } from "./members";
import { custom, designOf } from "./testFixtures";

/** Floor seams (#107) behind skids and joists that run the other way (#112). */
const overlap = (a: Member, b: Member) => [0, 1, 2].every((i) => a.min[i] < b.min[i] + b.size[i] - 0.01 && b.min[i] < a.min[i] + a.size[i] - 0.01);

describe.each([
  ["PART-002", 42],
  ["PART-003", 32],
] as const)("%s x %i, bigger than a sheet", (id, quantity) => {
  it.each(FORK_ENTRIES)("%s entry: the floor is spliced and nothing under it overlaps", (forkEntry) => {
    const d = designOf(getPart(id), { quantity }, custom({ handling: { forkEntry } }));
    const base = d.members.filter((m) => m.assembly === "base");
    const floorPieces = base.filter((m) => m.kind === "floor");
    expect(floorPieces.length).toBeGreaterThan(1);
    for (let i = 0; i < base.length; i++)
      for (let j = i + 1; j < base.length; j++) expect(overlap(base[i], base[j]), `${base[i].label} / ${base[j].label}`).toBe(false);
    // Seam cleats sit under the floor, in the cleat stock, and never on a skid or joist (a seam over a skid or joist needs none).
    const cleats = base.filter((m) => m.label === "Panel joint cleat");
    for (const c of cleats) expect(c.min[2] + c.size[2]).toBeLessThanOrEqual(-d.construction.floorMm + 0.01);
  });
});
