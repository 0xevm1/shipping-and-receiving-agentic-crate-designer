import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { FACE_AXES, FACE_IDS, type PartProfile } from "@/domain/profile";
import { planShipment } from "@/domain/shipment";
import { bomToCsv, shipmentToCsv } from "@/lib/csv";
import { catalogPart } from "@/lib/part";
import { cutList, designShipment, inputHash, summarize } from "./engine";
import { parityRequest } from "./parityCases";
import { CutListResponseSchema, DesignRequestSchema, DesignResponseSchema } from "./schemas";
import { ENGINE_REVISION, ENGINE_VERSION } from "./version";
import { APP } from "@/lib/appInfo";

describe("engine version", () => {
  it("is the package version plus the engine revision", () => {
    expect(ENGINE_VERSION).toBe(`${APP.version}+engine.${ENGINE_REVISION}`);
  });
});

describe("inputHash", () => {
  const req = parityRequest("PART-001", 4);

  it("is a SHA-256 hex digest, stable across key order", () => {
    const h = inputHash(req);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const reordered = { ranking: req.ranking, layoutKey: req.layoutKey, standards: req.standards, settings: { ...req.settings }, part: { ...req.part } };
    expect(inputHash(reordered)).toBe(h);
  });

  it("ignores how the part was loaded (model URL, file name, load facts)", () => {
    const part = { ...catalogPart(getPart("PART-001"), "blob:http://localhost/123"), model: "other.glb", mmPerUnit: 1, readAsMm: true };
    expect(inputHash({ ...req, part })).toBe(inputHash(req));
  });

  it("changes with every design input", () => {
    const h = inputHash(req);
    const variants = [
      { ...req, settings: { ...req.settings, quantity: 5 } },
      { ...req, settings: { ...req.settings, partGapMm: req.settings.partGapMm + 1 } },
      { ...req, part: { ...req.part, mass_kg: req.part.mass_kg + 0.1 } },
      { ...req, part: { ...req.part, name: "Renamed" } },
      {
        ...req,
        standards: {
          ...req.standards,
          rates: { ...req.standards.rates, costUsdPerM3: { ...req.standards.rates.costUsdPerM3, lumber: req.standards.rates.costUsdPerM3.lumber + 1 } },
        },
      },
      { ...req, layoutKey: "some-layout" },
      { ...req, ranking: "cost" as const },
    ];
    const hashes = new Set(variants.map(inputHash));
    expect(hashes.size).toBe(variants.length);
    expect(hashes.has(h)).toBe(false);
  });
});

/** A flat profile (no recesses) of the part's own size, as the browser measures one. */
function flatProfile(size: [number, number, number], cell = 20): PartProfile {
  const faces = {} as PartProfile["faces"];
  for (const id of FACE_IDS) {
    const [ua, va] = FACE_AXES["xyz".indexOf(id[1]) as 0 | 1 | 2];
    const cols = Math.round(size[ua] / cell);
    const rows = Math.round(size[va] / cell);
    faces[id] = { cols, rows, depth: Array.from({ length: cols * rows }, (_, i) => (i % 7) / 10) };
  }
  return { version: 1, sizeMm: size, cellMm: cell, faces };
}

describe("a part with a measured outline", () => {
  const req = parityRequest("PART-003", 4);
  const withProfile = { ...req, part: { ...req.part, profile: flatProfile(req.part.dimensions_mm) } };

  it("parses, and its outline is part of the input hash", () => {
    const parsed = DesignRequestSchema.parse(JSON.parse(JSON.stringify(withProfile)));
    expect(parsed.part.profile).toEqual(withProfile.part.profile);
    expect(inputHash(parsed)).toBe(inputHash(withProfile));
    expect(inputHash(withProfile)).not.toBe(inputHash(req));
  });

  it("rejects a damaged outline", () => {
    const bad = JSON.parse(JSON.stringify(withProfile));
    delete bad.part.profile.faces["+z"];
    expect(DesignRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("designShipment", () => {
  it("is planShipment, stamped and summarised", () => {
    const req = parityRequest("PART-002", 4, "cost");
    const out = designShipment(req);
    expect(out.plan).toEqual(planShipment(req.part, req.settings, req.layoutKey, req.standards, req.ranking));
    expect(out.engineVersion).toBe(ENGINE_VERSION);
    expect(out.inputHash).toBe(inputHash(req));
    expect(out.summary).toEqual(summarize(out.plan));
    const d = out.plan.crates[0].result.design!;
    expect(out.summary.crates[0]).toMatchObject({ outsideMm: d.layout.external, grossKg: d.grossKg, screws: d.screws });
  });

  it("validates against its own schemas", () => {
    const req = parityRequest("PART-003", 8);
    // Over the wire only the design fields of the part survive: the load facts aren't inputs.
    const parsed = DesignRequestSchema.parse(JSON.parse(JSON.stringify(req)));
    expect(parsed).toEqual({
      ...req,
      part: { id: req.part.id, name: req.part.name, mass_kg: req.part.mass_kg, dimensions_mm: req.part.dimensions_mm, material: req.part.material },
    });
    expect(inputHash(parsed)).toBe(inputHash(req));
    expect(DesignResponseSchema.safeParse(designShipment(req)).success).toBe(true);
  });

  it("gives a plan that survives the trip to and from a Web Worker unchanged", () => {
    for (const [id, q] of [
      ["PART-001", 8],
      ["PART-003", 1],
    ] as const) {
      const out = designShipment(parityRequest(id, q));
      expect(structuredClone(out)).toEqual(out);
    }
  });

  it("summarises a design problem instead of throwing", () => {
    const req = parityRequest("PART-001", 1);
    const out = designShipment({ ...req, part: { ...req.part, dimensions_mm: [30000, 10, 10] } });
    expect(out.summary.problem?.id).toBe("part-too-large");
    expect(out.summary.crates[0].outsideMm).toBeNull();
  });
});

describe("cutList", () => {
  it("is the Cut list tab's CSV and file name, stamped", () => {
    const req = parityRequest("PART-001", 4);
    const out = cutList({ ...req, units: "metric", scope: "crate", crateIndex: 0 });
    const plan = designShipment(req).plan;
    expect(out.csv).toBe(bomToCsv(req.part, plan.crates[0].result.design!, "metric"));
    expect(out.fileName).toBe("crate-PART-001-x4.csv");
    expect(CutListResponseSchema.safeParse(out).success).toBe(true);
  });

  it("lists the whole shipment of a split batch", () => {
    const req = parityRequest("PART-002", 1);
    const split = { ...req, settings: { ...req.settings, quantity: 200 } };
    const plan = designShipment(split).plan;
    expect(plan.split).toBe(true);
    const out = cutList({ ...split, units: "imperial", scope: "shipment", crateIndex: 0 }, plan);
    expect(out.csv).toBe(shipmentToCsv(split.part, plan, "imperial"));
    expect(out.fileName).toBe("crate-PART-002-x200-shipment.csv");
  });
});
