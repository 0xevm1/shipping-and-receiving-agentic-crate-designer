// @vitest-environment node
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { PARTS_NODE } from "@/lib/exportGlb";
import { catalogPart } from "@/lib/part";
import { designShipment } from "./engine";
import { buildBundleZip } from "./files";
import { bytesModelReader, crateGlb, parseGlb } from "./glb";
import { parityRequest } from "./parityCases";

/** A sample part's GLB as Node reads it from disk: no page, no fetch, no FileReader. */
const sampleBytes = (id: string) => {
  const b = readFileSync(`public/parts/${getPart(id).model}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("engine files in Node", () => {
  it("reads a part's GLB from its bytes", async () => {
    const scene = await parseGlb(sampleBytes("PART-001"));
    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    const [x, y, z] = getPart("PART-001").dimensions_mm;
    expect([size.x * 1000, size.y * 1000, size.z * 1000].map(Math.round)).toEqual([x, y, z].map(Math.round));
  });

  it("writes the crate as a GLB that reads back at the crate's outside size", async () => {
    const req = parityRequest("PART-002", 2);
    const design = designShipment(req).plan.crates[0].result.design!;
    const back = await parseGlb(await crateGlb(design));
    const size = new Box3().setFromObject(back).getSize(new Vector3());
    // Boards only (no parts): the outside box, in metres.
    expect(Math.abs(size.x * 1000 - design.layout.external[0])).toBeLessThan(1);
    expect(Math.abs(size.z * 1000 - design.layout.external[2])).toBeLessThan(1);
  });

  it("builds the whole download package without a browser or a server", async () => {
    const req = parityRequest("PART-001", 4);
    const { plan, inputHash, engineVersion } = designShipment(req);
    const part = catalogPart(getPart("PART-001"));
    const out = await buildBundleZip(
      { ...req, part, plan, crateIndex: 0, units: "metric", generatedAt: "2026-11-16T12:00:00.000Z" },
      bytesModelReader(sampleBytes("PART-001")),
    );
    expect(out.name).toBe("crate-PART-001-x4.zip");
    expect(out.inputHash).toBe(inputHash);
    expect(out.engineVersion).toBe(engineVersion);
    const files = unzipSync(out.zip);
    expect(Object.keys(files)).toEqual(["crate-PART-001-x4.glb", "crate-PART-001-x4.pdf", "cut-list.csv", "design.json", "README.txt"]);
    expect(new TextDecoder().decode(files["crate-PART-001-x4.pdf"].subarray(0, 5))).toBe("%PDF-");
    // Every file carries the stamp (spec §5.1).
    const text = (n: string) => new TextDecoder("latin1").decode(files[n]);
    expect(text("crate-PART-001-x4.pdf")).toContain(`inputHash=${inputHash}`);
    expect(text("cut-list.csv")).toContain(`# Engine ${engineVersion}, input ${inputHash}\n`);
    expect(JSON.parse(text("design.json")).engine).toEqual({ version: engineVersion, inputHash });
    expect(text("README.txt")).toContain(`Input:     ${inputHash}`);
    // The GLB holds the four parts in their slots.
    const glb = await parseGlb(files["crate-PART-001-x4.glb"].slice().buffer as ArrayBuffer);
    expect(glb.getObjectByName(PARTS_NODE)?.children).toHaveLength(4);
    expect(glb.userData).toEqual({ engineVersion, inputHash });
  });
});
