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
    expect(Object.keys(req.part).sort()).toEqual(["dimensions_mm", "id", "mass_kg", "material", "name", "profile"]);
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
});
