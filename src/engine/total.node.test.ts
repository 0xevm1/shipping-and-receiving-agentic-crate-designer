// @vitest-environment node
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { parseDesignFile, restoreDesign } from "@/domain/designFile";
import { loadAwareBudget } from "@/domain/testFixtures";
import { printableFromDesignFile } from "@/lib/printable";
import { catalogPart } from "@/lib/part";
import { buildArtifact, buildMultiBundleZip, type BundleManifest } from "./artifacts";
import { designShipment, inputHash } from "./engine";
import { buildBundleZip } from "./files";
import { bytesModelReader } from "./glb";
import { parityRequest, totalParityRequest } from "./parityCases";
import { designRequestFor, totalSplitFor, withTotal } from "./request";
import { DesignRequestSchema } from "./schemas";
import { ENGINE_VERSION } from "./version";
import { DEFAULT_STANDARDS } from "@/domain/standards";

/**
 * A job's total quantity in the engine's requests and files (#140): the total is an explicit, hashed
 * input of the request, built by the one request builder, and every shipment-level file made from it
 * describes the whole shipment. Requests without a total are untouched.
 */
const AT = "2026-11-17T12:00:00.000Z";
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const sampleBytes = (id: string) => {
  const b = readFileSync(`public/parts/${getPart(id).model}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const loaded = (id: string, total: number) => {
  const req = totalParityRequest(id, total);
  return { ...req, part: catalogPart(getPart(id)) };
};

describe("the total as a request input", () => {
  it("leaves a request without a total hashing, validating and designing as before", () => {
    const req = parityRequest("PART-001", 4);
    expect(inputHash({ ...req, total: null })).toBe(inputHash(req));
    expect(inputHash({ ...req, total: undefined })).toBe(inputHash(req));
    expect(withTotal(req, null)).toBe(req);
    expect(designRequestFor({ ...req, total: null })).toEqual(designRequestFor(req));
    expect(DesignRequestSchema.parse(req)).not.toHaveProperty("total");
    expect(designShipment(req).plan.total).toBeUndefined();
  });

  it("hashes the total, so a total and the batch it was planned from are different requests", () => {
    const whole = totalParityRequest("PART-001", 1000);
    const { total, ...bare } = whole;
    expect(total).toBeDefined();
    expect(inputHash(whole)).not.toBe(inputHash(bare));
    const other = totalParityRequest("PART-001", 1001);
    expect(inputHash(other)).not.toBe(inputHash(whole));
  });

  it("builds one request for one total, whatever crate is on screen (quantity, layout pick, ranking)", () => {
    const whole = totalParityRequest("PART-001", 1000);
    const onScreen = { ...parityRequest("PART-001", 7), layoutKey: "u:other", ranking: "cost" as const };
    expect(inputHash(withTotal(onScreen, whole.total))).toBe(inputHash(whole));
    expect(inputHash(designRequestFor({ ...onScreen, total: whole.total }))).toBe(inputHash(whole));
  });

  it("takes a total only as crate types that make up the parts", () => {
    const whole = totalParityRequest("PART-001", 1000);
    expect(DesignRequestSchema.safeParse(whole).success).toBe(true);
    expect(DesignRequestSchema.safeParse({ ...whole, total: { ...whole.total!, parts: 999 } }).success).toBe(false);
    expect(totalSplitFor(1000, [])).toBeNull();
    expect(totalSplitFor(5, [{ count: 1, quantity: 4, layoutKey: null }])).toBeNull();
    expect(totalSplitFor(1000, whole.total!.types)).toEqual(whole.total);
  });

  it("designs the whole shipment: crate types with counts, the total parts, the gross and the cost", () => {
    const out = designShipment(totalParityRequest("PART-001", 10000));
    expect(out.plan.total).toBe(10000);
    expect(out.summary).toMatchObject({ quantity: 10000, split: true, totals: { parts: 10000 } });
    expect(out.summary.totals.crates).toBe(out.summary.crates.reduce((n, c) => n + c.count, 0));
    expect(out.summary.totals.grossKg).toBeGreaterThan(100_000);
  });
});

describe("files made for a total", () => {
  it("writes the shipment CSV for the whole shipment, stamped with the total's hash", async () => {
    const req = totalParityRequest("PART-001", 10000);
    const csv = await buildArtifact("csv", { ...req, units: "imperial" }, null);
    const body = new TextDecoder().decode(csv.bytes);
    expect(csv.fileName).toBe("crate-PART-001-x10000-shipment.csv");
    expect(csv.inputHash).toBe(inputHash(req));
    expect(body).toMatch(/^# Shipment of 10,000 x PART-001 /);
    expect(body).toMatch(/# \d+ crates, gross [\d,]+ lb in all/);
    for (const line of ["# Wood for every crate: plywood", "# Crate cost $", "# Freight: A class"]) expect(body).toContain(line);
    expect(body).toContain(`# Engine ${ENGINE_VERSION}, input ${csv.inputHash}`);
    // Plain ASCII, like the other imperial cut lists.
    expect([...body].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it("writes the PDF for the whole shipment with a build sheet and label for each crate type", async () => {
    const req = totalParityRequest("PART-001", 10000);
    const pdf = text((await buildArtifact("pdf", { ...req, units: "imperial", generatedAt: AT, timeZone: "UTC" }, null)).bytes);
    expect(pdf).toContain("Shipment of 10,000");
    expect(pdf).toContain("Crates");
    for (const label of ["Crate cost, all crates", "Wood screws, all crates", "Labour, all crates", "Freight class"]) expect(pdf).toContain(label);
    for (const t of designShipment(req).plan.crates) expect(pdf).toContain(`Crate ${t.label}: ${t.quantity}`);
    // The per-crate recommendation does not speak for a total.
    expect(pdf).not.toContain("per crate; the sweep recommends");
  });

  it("names a GLB for each crate type", async () => {
    const req = loaded("PART-001", 10000);
    const read = bytesModelReader(sampleBytes("PART-001"));
    const a = await buildArtifact("glb", { ...req, crateIndex: 0 }, read);
    const b = await buildArtifact("glb", { ...req, crateIndex: 1 }, read);
    expect([a.fileName, b.fileName]).toEqual(["crate-PART-001-x10000-crate-A.glb", "crate-PART-001-x10000-crate-B.glb"]);
  });

  it("bundles a total as one configuration, once, however many requests describe it", async () => {
    const whole = loaded("PART-001", 1000);
    const onScreen = withTotal({ ...parityRequest("PART-001", 3), part: whole.part }, whole.total);
    const out = await buildMultiBundleZip([whole, onScreen], bytesModelReader(sampleBytes("PART-001")), { generatedAt: AT, timeZone: "UTC" });
    const files = unzipSync(out.zip);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as BundleManifest;
    expect(manifest.configurations).toHaveLength(1);
    const c = manifest.configurations[0]!;
    expect(c).toMatchObject({ folder: "01-x1000", quantity: 1000, total: 1000, inputHash: inputHash(whole), split: true });
    expect(c.perCrate).toEqual(whole.total!.types.map((t) => t.quantity));
    expect(c.files.map((f) => f.path)).toEqual([
      "01-x1000/crate-PART-001-x1000-crate-A.glb",
      "01-x1000/crate-PART-001-x1000-crate-B.glb",
      "01-x1000/crate-PART-001-x1000.pdf",
      "01-x1000/crate-PART-001-x1000-shipment.csv",
    ]);
    expect(text(files["01-x1000/crate-PART-001-x1000-shipment.csv"])).toContain("# Shipment of 1,000 x PART-001");
  }, 60_000);

  it("leaves the manifest of a configuration without a total as it was (no total key)", async () => {
    const req = { ...parityRequest("PART-002", 2), part: catalogPart(getPart("PART-002")) };
    const out = await buildMultiBundleZip([req], bytesModelReader(sampleBytes("PART-002")), { generatedAt: AT, timeZone: "UTC" });
    expect(out.manifest.configurations[0]).not.toHaveProperty("total");
  }, 60_000);

  it("builds the Export package for a total: the shipment's files, and a design file that carries the total", async () => {
    const req = loaded("PART-001", 10000);
    const { plan } = designShipment(req);
    const out = await buildBundleZip(
      { ...req, plan, total: req.total, crateIndex: 0, units: "imperial", generatedAt: AT, timeZone: "UTC", layoutKey: req.layoutKey },
      bytesModelReader(sampleBytes("PART-001")),
    );
    expect(out.name).toBe("crate-PART-001-x10000.zip");
    expect(out.inputHash).toBe(inputHash(req));
    const files = unzipSync(out.zip);
    expect(Object.keys(files)).toEqual([
      "crate-PART-001-x10000-crate-A.glb",
      "crate-PART-001-x10000-crate-B.glb",
      "crate-PART-001-x10000.pdf",
      "cut-list-crate-A.csv",
      "cut-list-crate-B.csv",
      "shipment-cut-list.csv",
      "design.json",
      "README.txt",
    ]);
    expect(text(files["README.txt"])).toMatch(/Quantity: {2}10,000, shipping as [\d,]+ x crate A/);
    expect(text(files["shipment-cut-list.csv"])).toContain("# Shipment of 10,000 x PART-001");
    expect(text(files["crate-PART-001-x10000.pdf"])).toContain(`inputHash=${out.inputHash}`);

    // The design file records the total, reads back, and prints and restores as the whole shipment.
    const design = text(files["design.json"]);
    const parsed = parseDesignFile(design);
    expect(parsed.ok && parsed.file.total).toEqual(req.total);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(restoreDesign(parsed.file, req.part, DEFAULT_STANDARDS).notes).toEqual([]);
    const printed = printableFromDesignFile(design, DEFAULT_STANDARDS, "imperial", AT, "UTC");
    expect(printed.ok && printed.doc.title).toBe("Shipment of 10,000 × Machined steel bracket");
    expect(printed.ok && printed.doc.shipment.rows.map((r) => r.label)).toContain("Crate cost, all crates");
  }, 60_000);
});

describe("building the files for a total is fast (#140)", () => {
  // Measured idle: CSV 1-25 ms, PDF 28-160 ms at 1,000 and 10,000 parts (the same as without a total: two crate types, whatever the total).
  it.each([1000, 10000])(
    "builds the CSV and the PDF for every sample part at %i parts",
    async (total) => {
      const budget = loadAwareBudget(2000, 500);
      for (const id of ["PART-001", "PART-002", "PART-003"]) {
        const req = totalParityRequest(id, total);
        for (const kind of ["csv", "pdf"] as const) {
          const t = performance.now();
          await buildArtifact(kind, { ...req, generatedAt: AT, timeZone: "UTC" }, null);
          expect(performance.now() - t).toBeLessThan(budget);
        }
      }
    },
    60_000,
  );
});
