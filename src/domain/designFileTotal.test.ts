import { describe, expect, it } from "vitest";
import { getPart } from "./catalog";
import { DEFAULT_SETTINGS, computeDesign } from "./design";
import { DESIGN_SCHEMA_VERSION, parseDesignFile, serializeDesign, type DesignFilePart } from "./designFile";
import { base64UrlEncode, readShareHash } from "./shareLink";
import { planTotalShipment, type TotalSplit } from "./shipment";
import { DEFAULT_STANDARDS } from "./standards";

/** Format 5 (#140): the design file can carry a job's total quantity as its crate types. */
const p = getPart("PART-002");
const part: DesignFilePart = {
  source: "catalog",
  id: p.id,
  name: p.name,
  material: p.material,
  mass_kg: p.mass_kg,
  dimensions_mm: p.dimensions_mm,
  model: p.model,
  units: "m",
  up: "z",
};
const APP = { name: "crate-designer", version: "0.0.0-test" };
const settings = { ...DEFAULT_SETTINGS, quantity: 4 };
const design = computeDesign(p, settings).design!;
const total: TotalSplit = { parts: 1000, types: [{ count: 250, quantity: 4, layoutKey: design.layout.key }] };
const write = (extra: object = {}) =>
  JSON.parse(serializeDesign({ app: APP, part, settings, layoutKey: design.layout.key, design, savedAt: "2026-11-17T12:00:00.000Z", ...extra }));

describe("the design file's total (format 5)", () => {
  it("is written only when there is one, and read back", () => {
    expect(write()).not.toHaveProperty("total");
    const plan = planTotalShipment(p, settings, total, DEFAULT_STANDARDS);
    const doc = write({ plan, total });
    expect(doc).toMatchObject({ schemaVersion: DESIGN_SCHEMA_VERSION, total });
    const r = parseDesignFile(JSON.stringify(doc));
    expect(r.ok && r.file.total).toEqual(total);
    expect(doc.summary.shipment).toEqual([{ count: 250, quantity: 4 }]);
  });

  it("opens a format 4 file as it is: no total", () => {
    const doc = write();
    doc.schemaVersion = 4;
    const r = parseDesignFile(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.error);
    expect(r.file.schemaVersion).toBe(5);
    expect(r.file.total).toBeUndefined();
  });

  it("refuses a total whose crates don't make up its parts, in a file and in a share link", () => {
    const doc = write({ total });
    doc.total.parts = 999;
    expect(parseDesignFile(JSON.stringify(doc)).ok).toBe(false);
    const link = readShareHash(`#design=${base64UrlEncode(JSON.stringify(doc))}`);
    expect(link?.ok).toBe(false);
  });

  it("opens through a share link with its total", () => {
    const r = readShareHash(`#design=${base64UrlEncode(JSON.stringify(write({ total })))}`);
    expect(r?.ok && r.file.total).toEqual(total);
  });
});
