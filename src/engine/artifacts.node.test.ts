// @vitest-environment node
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { catalog, getPart } from "@/domain/catalog";
import { PARTS_NODE } from "@/lib/exportGlb";
import { isRecommended } from "@/lib/printable";
import { catalogPart } from "@/lib/part";
import { artifactCsvText, recommendedRequest } from "./artifactCases";
import { ARTIFACT_KINDS, buildArtifact, buildMultiBundleZip, sweepFor, type BundleManifest } from "./artifacts";
import { designShipment } from "./engine";
import { bytesModelReader, parseGlb } from "./glb";
import { parityRequest } from "./parityCases";
import type { DesignRequest } from "./schemas";
import { sha256Hex } from "./sha256";
import { ENGINE_VERSION } from "./version";

/** A sample part's GLB as Node reads it from disk. */
const sampleBytes = (id: string) => {
  const b = readFileSync(`public/parts/${getPart(id).model}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const AT = "2026-11-17T12:00:00.000Z";
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const ab = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
/** A request with the browser's loaded part (catalog part with its model URL and scale). */
const loaded = (req: DesignRequest): DesignRequest => ({ ...req, part: catalogPart(getPart(req.part.id)) });

describe("artifacts in Node", () => {
  it("runs without a DOM", () => expect(typeof document).toBe("undefined"));

  it.each(catalog.parts.map((p) => p.id))("builds every artifact kind for %s at its recommended quantity, stamped", async (id) => {
    const req = loaded(recommendedRequest(id));
    const { inputHash, plan } = designShipment(req);
    const read = bytesModelReader(sampleBytes(id));
    for (const kind of ARTIFACT_KINDS) {
      const a = await buildArtifact(kind, { ...req, generatedAt: AT, timeZone: "UTC" }, read);
      expect(a).toMatchObject({ kind, engineVersion: ENGINE_VERSION, inputHash });
      expect(a.sha256).toBe(sha256Hex(a.bytes));
      expect(a.bytes.length).toBeGreaterThan(100);
    }

    // The GLB reloads, carries the stamp and is the crate's outside size within 1 mm.
    const glb = await buildArtifact("glb", req, read);
    const scene = await parseGlb(ab(glb.bytes));
    expect(scene.userData).toMatchObject({ engineVersion: ENGINE_VERSION, inputHash });
    const design = plan.crates[0].result.design!;
    expect(scene.getObjectByName(PARTS_NODE)?.children).toHaveLength(design.layout.slots.length);
    const size = new Box3().setFromObject(scene.getObjectByName("Crate")!).getSize(new Vector3());
    const [x, y, z] = design.layout.external;
    expect(Math.abs(size.x * 1000 - x)).toBeLessThan(1);
    expect(Math.abs(size.y * 1000 - y)).toBeLessThan(1);
    expect(Math.abs(size.z * 1000 - z)).toBeLessThan(1);

    // The PDF states the stamp, the recommendation and the constraint that stopped a larger crate.
    const pdf = latin1((await buildArtifact("pdf", { ...req, generatedAt: AT }, read)).bytes);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain(inputHash);
    expect(pdf).toContain(`inputHash=${inputHash}`);
    const sweep = sweepFor(req);
    const rec = sweep.recommendation!;
    // The recommendation applied is one crate of that quantity and layout (§7.10, §7.16).
    expect(isRecommended(plan, sweep)).toBe(true);
    expect(pdf).toContain(`Recommended: ${rec.quantity} per crate`);
    if (rec.stoppedBy) expect(pdf).toContain(`${rec.stoppedBy.quantity} per crate fails the`);
    expect(pdf).toContain("placeholder");

    // The CSV has its stamp line.
    const csv = new TextDecoder().decode((await buildArtifact("csv", req, null)).bytes);
    expect(csv).toContain(`# Engine ${ENGINE_VERSION}, input ${inputHash}\n`);
  });

  it("reads a part's model in its frame, as the browser does: a Y-up file's parts are the Z-up file's (#105)", async () => {
    const fileBytes = (path: string) => {
      const b = readFileSync(path);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const req = loaded(parityRequest("PART-001", 2));
    const partsBox = async (bytes: ArrayBuffer, upAxis: "z" | "y") => {
      // The part as the browser and the server hand it over: its design fields plus how its file is read.
      const part: DesignRequest["part"] = { ...catalogPart(getPart("PART-001")), upAxis } as DesignRequest["part"];
      const glb = await buildArtifact("glb", { ...req, part }, bytesModelReader(bytes));
      const parts = (await parseGlb(ab(glb.bytes))).getObjectByName(PARTS_NODE)!;
      return new Box3().setFromObject(parts);
    };
    const zUp = await partsBox(sampleBytes("PART-001"), "z");
    const yUp = await partsBox(fileBytes("fixtures/units-axis/bracket-y-up.glb"), "y");
    for (const k of ["min", "max"] as const) {
      expect(yUp[k].x).toBeCloseTo(zUp[k].x, 3);
      expect(yUp[k].y).toBeCloseTo(zUp[k].y, 3);
      expect(yUp[k].z).toBeCloseTo(zUp[k].z, 3);
    }
  });

  it("gives the same PDF bytes for the same input and time", async () => {
    const req = { ...parityRequest("PART-002", 2), generatedAt: AT, timeZone: "UTC" };
    const [a, b] = await Promise.all([buildArtifact("pdf", req, null), buildArtifact("pdf", req, null)]);
    expect(a.sha256).toBe(b.sha256);
  });

  it("says when a crate is not the recommended quantity", async () => {
    const req = parityRequest("PART-001", 2);
    const pdf = latin1((await buildArtifact("pdf", req, null)).bytes);
    expect(pdf).toMatch(/2 per crate; the sweep recommends \d+/);
  });

  it("writes the same cut-list CSV bytes as jsdom", async () => {
    await expect(await artifactCsvText()).toMatchFileSnapshot("./__snapshots__/artifacts-csv.txt");
  });

  it("bundles several configurations: a folder each, the manifest and the comparison", async () => {
    const current = loaded(parityRequest("PART-002", 2));
    const shortlist = sweepFor(current).shortlist.map((p) => ({
      ...current,
      settings: { ...current.settings, quantity: p.quantity },
      layoutKey: p.crate!.layoutKey,
    }));
    const configs = [current, ...shortlist, current]; // the duplicate is kept once
    const out = await buildMultiBundleZip(configs, bytesModelReader(sampleBytes("PART-002")), { generatedAt: AT, timeZone: "UTC", units: "metric" });

    const files = unzipSync(out.zip);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as BundleManifest;
    expect(manifest).toEqual(out.manifest);
    expect(manifest).toMatchObject({
      kind: "crate-designer/bundle",
      version: 1,
      engineVersion: ENGINE_VERSION,
      created: AT,
      costBasis: "crate-only",
      placeholderCosts: true,
    });
    expect(manifest.part).toEqual({ id: "PART-002", name: getPart("PART-002").name });
    expect(out.name).toBe(`crates-PART-002-${manifest.configurations.length}-configs.zip`);

    // One folder per configuration with its GLB, PDF and CSV; the recommendation is marked.
    const folders = manifest.configurations.map((c) => c.folder);
    expect(folders[0]).toBe("01-x2");
    expect(folders.filter((f) => f.endsWith("-recommended"))).toHaveLength(1);
    for (const c of manifest.configurations) {
      expect(c.files.map((f) => f.kind)).toEqual(["glb", "pdf", "csv"]);
      for (const f of c.files) {
        expect(f.path.startsWith(`${c.folder}/`)).toBe(true);
        expect(files[f.path].length).toBe(f.bytes);
        expect(sha256Hex(files[f.path])).toBe(f.sha256);
      }
    }
    const hashes = [...new Set(configs.map((r) => designShipment(r).inputHash))];
    expect(manifest.configurations.map((c) => c.inputHash)).toEqual(hashes);
    const rec = manifest.configurations.find((c) => c.recommended)!;
    expect(rec.quantity).toBe(manifest.recommendation!.quantity);
    expect(manifest.recommendation!.stoppedBy?.constraint).toBeTruthy();

    // Every zipped file is in the manifest (and the manifest itself).
    const listed = [...manifest.files, ...manifest.configurations.flatMap((c) => c.files)].map((f) => f.path);
    expect(Object.keys(files).sort()).toEqual([...listed, "manifest.json"].sort());

    // The comparison summary: a row per configuration, the rationale, no freight dollars.
    const comparison = latin1(files["comparison.pdf"]);
    expect(comparison.startsWith("%PDF-")).toBe(true);
    for (const f of folders) expect(comparison).toContain(f);
    expect(comparison).toContain("Why this quantity");
    expect(comparison).toContain("Constraint that stopped a larger crate");
    expect(comparison).toContain("Freight is not priced");
    expect(comparison).toContain("placeholder");
    expect(comparison).not.toMatch(/freight[^)]{0,40}\$\d/i);
    expect(JSON.stringify(manifest)).not.toMatch(/freightUsd/);
  }, 60_000);
});
