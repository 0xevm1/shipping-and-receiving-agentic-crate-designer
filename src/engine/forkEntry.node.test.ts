// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { FORK_ENTRIES, type ForkEntry } from "@/domain/forkEntry";
import { parseStandards } from "@/domain/standards";
import { catalogPart } from "@/lib/part";
import { buildArtifact } from "./artifacts";
import { designShipment } from "./engine";
import { parseGlb } from "./glb";
import { parityRequest } from "./parityCases";
import { DesignRequestSchema, type DesignRequest } from "./schemas";

/** The fork-entry standard through the shared engine (#112): the artifacts the server writes follow it as the browser's do. */
const AT = "2026-11-17T12:00:00.000Z";
const request = (forkEntry: ForkEntry): DesignRequest => {
  const base = { ...parityRequest("PART-003", 8), part: catalogPart(getPart("PART-003")) };
  return { ...base, standards: { ...base.standards, handling: { ...base.standards.handling, forkEntry } } };
};
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const ab = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

describe("the fork-entry standard in the engine", () => {
  it("is part of the input hash: the same part under another entry is another input", () => {
    const hashes = FORK_ENTRIES.map((e) => designShipment(request(e)).inputHash);
    expect(new Set(hashes).size).toBe(3);
  });

  it("reads a stored request from before the field existed as end entry", () => {
    const handling: Record<string, unknown> = { ...request("ends").standards.handling };
    delete handling.forkEntry;
    const stored = JSON.parse(JSON.stringify({ ...request("ends"), standards: { ...request("ends").standards, handling } })) as unknown;
    const parsed = DesignRequestSchema.parse(stored);
    expect(parsed.standards.handling.forkEntry).toBe("ends");
    expect(designShipment(parsed).inputHash).toBe(designShipment(request("ends")).inputHash);
    expect(parseStandards(parsed.standards).ok).toBe(true);
  });

  it.each(FORK_ENTRIES)("writes the %s CSV, PDF label and GLB boards", async (entry) => {
    const req = { ...request(entry), generatedAt: AT, timeZone: "UTC" };
    const design = designShipment(req).plan.crates[0].result.design!;
    expect(design.construction.forkEntry).toBe(entry);

    const csv = new TextDecoder().decode((await buildArtifact("csv", { ...req, units: "metric" }, null)).bytes);
    expect(csv.includes("Base: Lifting block,lumber")).toBe(entry === "fourWay");
    // The skid cut is the length for end and four-way entry, the width for side entry.
    const [extL, extW] = design.layout.external;
    expect(csv).toContain(`Base: Skid,lumber,89 × 89,${Math.round(entry === "sides" ? extW : extL)},`);

    const pdf = text((await buildArtifact("pdf", req, null)).bytes);
    const label = { ends: "FORK ENTRY FROM THE ENDS", sides: "FORK ENTRY FROM THE SIDES", fourWay: "FORK ENTRY FROM ALL FOUR SIDES" }[entry];
    expect(pdf).toContain(`(${label}`);
    expect(pdf.includes("END VIEW")).toBe(entry === "fourWay");
    expect(pdf.includes("SIDE VIEW")).toBe(entry === "fourWay");

    const scene = await parseGlb(ab((await buildArtifact("glb", req, null)).bytes));
    const names: string[] = [];
    scene.traverse((o) => names.push(o.name));
    const blocks = names.filter((n) => /^Lifting[ _]block[ _]\d+$/.test(n));
    expect(blocks).toHaveLength(entry === "fourWay" ? 2 * design.construction.skidCount : 0);
    expect(names.filter((n) => /^Skid[ _]\d+$/.test(n))).toHaveLength(design.construction.skidCount);
  });
});
