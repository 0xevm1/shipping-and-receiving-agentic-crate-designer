import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { FACE_IDS, type PartProfile } from "@/domain/profile";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { catalogPart } from "@/lib/part";
import { designShipment } from "./engine";
import { designPartHash, designRequestFor, sweepRequestFor } from "./request";
import { DesignRequestSchema } from "./schemas";
import { SweepRequestSchema, sweepInputHash } from "./sweep";

const face = { cols: 2, rows: 1, depth: [0, 10] };
const PROFILE: PartProfile = {
  version: 1,
  sizeMm: [360, 220, 258],
  cellMm: 2,
  faces: Object.fromEntries(FACE_IDS.map((f) => [f, face])) as PartProfile["faces"],
};

describe('the one request builder (#46 "same inputs")', () => {
  it("cuts a loaded part to its design fields and the settings to the sweep's rules", () => {
    const loaded = { ...catalogPart(getPart("PART-001")), profile: PROFILE };
    const req = sweepRequestFor({ part: loaded, rules: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS, total: 40 });
    expect(SweepRequestSchema.parse(req)).toEqual(req);
    expect(Object.keys(req.part).sort()).toEqual(["dimensions_mm", "id", "mass_kg", "material", "name", "profile", "suggested_quantities"]);
    expect(req.rules).not.toHaveProperty("quantity");
    expect(req.total).toBe(40);
    const design = designRequestFor({
      part: loaded,
      settings: { ...DEFAULT_SETTINGS, quantity: 4 },
      standards: DEFAULT_STANDARDS,
      layoutKey: null,
      ranking: "volume",
    });
    expect(DesignRequestSchema.parse(design)).toEqual(design);
    expect(design.part).toEqual(req.part);
  });

  it("gives the same answers from the loaded part and from the part as the server stores it (JSON)", () => {
    const loaded = { ...catalogPart(getPart("PART-001")), profile: PROFILE };
    const stored = JSON.parse(JSON.stringify(sweepRequestFor({ part: loaded, rules: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS }).part));
    const a = sweepRequestFor({ part: loaded, rules: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS });
    const b = sweepRequestFor({ part: stored, rules: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS });
    // The same hash is the same inputs (the integration test sweeps both sides in full).
    expect(sweepInputHash(b)).toBe(sweepInputHash(a));
    expect(b).toEqual(JSON.parse(JSON.stringify(a)));
    const d = (part: typeof loaded) =>
      designShipment(designRequestFor({ part, settings: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS, layoutKey: null, ranking: "volume" }));
    expect(d(stored).inputHash).toBe(d(loaded).inputHash);
  });

  it("sends the part's centre of gravity (#110) with every request, and it is an input of the hashes", () => {
    const loaded = catalogPart(getPart("PART-001"));
    const cog = { offsetMm: [-38.3, 0, -48.6] as [number, number, number], source: "estimated" as const };
    const withCog = { ...loaded, cog };
    const rules = { part: withCog, rules: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS };
    const sweep = sweepRequestFor(rules);
    expect(sweep.part.cog).toEqual(cog);
    expect(SweepRequestSchema.parse(sweep)).toEqual(sweep);
    const design = (part: typeof loaded) =>
      designRequestFor({ part, settings: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS, layoutKey: null, ranking: "volume" });
    expect(DesignRequestSchema.parse(design(withCog)).part.cog).toEqual(cog);
    // Another source, another offset, or none at all: another request and another hash.
    expect(sweepInputHash(sweepRequestFor({ ...rules, part: { ...loaded } }))).not.toBe(sweepInputHash(sweep));
    expect(designShipment(design(withCog)).inputHash).not.toBe(designShipment(design(loaded)).inputHash);
    expect(designShipment(design({ ...withCog, cog: { ...cog, source: "supplied" } })).inputHash).not.toBe(designShipment(design(withCog)).inputHash);
    expect(designPartHash(withCog)).not.toBe(designPartHash(loaded));
    expect(designPartHash(JSON.parse(JSON.stringify(withCog)))).toBe(designPartHash(withCog));
    // A part without one has no `cog` key at all, as before.
    expect(Object.keys(sweepRequestFor({ ...rules, part: loaded }).part)).not.toContain("cog");
    // The browser and the server (the stored JSON) design the same crate from it.
    const stored = JSON.parse(JSON.stringify(sweep.part));
    expect(designShipment(design(stored)).inputHash).toBe(designShipment(design(withCog)).inputHash);
  });

  it("rejects a centre of gravity outside the part's box or not finite when a request arrives", () => {
    const loaded = catalogPart(getPart("PART-001"));
    const parse = (offsetMm: number[]) =>
      DesignRequestSchema.safeParse(
        designRequestFor({
          part: { ...loaded, cog: { offsetMm: offsetMm as [number, number, number], source: "supplied" } },
          settings: DEFAULT_SETTINGS,
          standards: DEFAULT_STANDARDS,
          layoutKey: null,
          ranking: "volume",
        }),
      );
    expect(parse([180, 110, 129]).success).toBe(true); // on the faces of 360 × 220 × 258
    expect(parse([181, 0, 0]).success).toBe(false);
    expect(parse([0, 0, Number.POSITIVE_INFINITY]).success).toBe(false);
  });

  it("hashes a part by its design fields: the outline counts, the model URL doesn't", () => {
    const loaded = catalogPart(getPart("PART-001"));
    const base = designPartHash(loaded);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    const elsewhere = { ...loaded, modelUrl: "/elsewhere.glb" };
    expect(designPartHash(elsewhere)).toBe(base);
    expect(designPartHash(JSON.parse(JSON.stringify(loaded)))).toBe(base);
    expect(designPartHash({ ...loaded, profile: PROFILE })).not.toBe(base);
    expect(designPartHash({ ...loaded, mass_kg: loaded.mass_kg + 1 })).not.toBe(base);
  });

  it("sets the sweep's candidates from the part's suggested quantities, the same for every caller (#133)", () => {
    const loaded = catalogPart(getPart("PART-001"));
    const req = (part: Parameters<typeof sweepRequestFor>[0]["part"]) => sweepRequestFor({ part, rules: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS });
    expect(req(loaded).candidates).toEqual([...loaded.suggested_quantities].sort((a, b) => a - b));
    // The browser's loaded part and the part as the server stores it (JSON) give one request.
    const stored = JSON.parse(JSON.stringify(req(loaded).part));
    expect(req(stored)).toEqual(req(loaded));
    expect(sweepInputHash(req(stored))).toBe(sweepInputHash(req(loaded)));
    // Whole numbers 1..200, once each, ascending; a part with none (the API, the CLI, a loaded GLB) gets 1, 4 and 8.
    expect(req({ ...loaded, suggested_quantities: [8, 2, 8, 0, 3.5, 250, 6] }).candidates).toEqual([2, 6, 8]);
    expect(req({ ...loaded, suggested_quantities: [] }).candidates).toEqual([1, 4, 8]);
    expect(req({ id: "x", name: "x", mass_kg: 5, dimensions_mm: loaded.dimensions_mm }).candidates).toEqual([1, 4, 8]);
    // Other suggestions are another sweep, and another part version.
    expect(sweepInputHash(req({ ...loaded, suggested_quantities: [2, 6] }))).not.toBe(sweepInputHash(req(loaded)));
    expect(designPartHash({ ...loaded, suggested_quantities: [2, 6] })).not.toBe(designPartHash(loaded));
    expect(designPartHash({ ...loaded, suggested_quantities: [8, 4, 1] })).toBe(designPartHash(loaded));
  });
});
