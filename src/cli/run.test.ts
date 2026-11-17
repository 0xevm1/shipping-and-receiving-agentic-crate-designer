// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPart } from "@/domain/catalog";
import { GLB_MESSAGES } from "@/domain/glb";
import { DesignsApiResponseSchema } from "@/lib/api/designs";
import { parseCliArgs } from "./args";
import { CliError, rankingCsv, runOffline, runOnline, summaryText } from "./run";

const SAMPLE = `public/parts/${getPart("PART-001").model}`;
const bytes = new Uint8Array(readFileSync(SAMPLE));
const options = (argv: string[]) => {
  const r = parseCliArgs(argv);
  if (!r.ok) throw new Error(String(r.error));
  return r.options;
};
const outDir = () => mkdtempSync(join(tmpdir(), "crate-cli-"));

describe("crate CLI, offline", () => {
  it("runs the engine here and writes the ranking, design JSON, GLB, PDF and cut list", { timeout: 60_000 }, async () => {
    const out = outDir();
    const { report, files } = await runOffline(
      options([SAMPLE, "--mass", "21.5", "--total", "40", "--out", out, "--offline"]),
      bytes,
      new Date("2026-11-17T12:00:00Z"),
    );
    expect(DesignsApiResponseSchema.parse(report)).toEqual(report);
    expect(report.recommendation).not.toBeNull();
    expect(report.total).toMatchObject({ total: 40 });
    expect(report.part).toMatchObject({ massKg: 21.5 });
    const written = readdirSync(out).sort();
    expect(written).toEqual([...files].sort());
    expect(written).toEqual(expect.arrayContaining(["designs.json", "ranking.csv", "design.json", "README.txt"]));
    // 40 parts don't fit one crate: the package is the whole batch, split evenly.
    expect(written.some((f) => /cut-list.*\.csv$/.test(f))).toBe(true);
    expect(written.some((f) => f.endsWith(".glb"))).toBe(true);
    const pdf = written.find((f) => f.endsWith(".pdf"))!;
    expect(readFileSync(join(out, pdf)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(JSON.parse(readFileSync(join(out, "designs.json"), "utf8"))).toEqual(report);
    const csv = readFileSync(join(out, "ranking.csv"), "utf8").trim().split("\n");
    expect(csv[0]).toMatch(/^rank,quantity_per_crate,layout,usd_per_part/);
    expect(csv).toHaveLength(report.configurations.length + 1);
    expect(summaryText(report)).toMatch(/^Recommended: \d+ per crate\./);
    expect(summaryText(report)).toMatch(/40 parts: \d+ crate\(s\)/);
  });

  it("refuses a file the app refuses, with the app's message", async () => {
    const text = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
    await expect(runOffline(options(["part.gltf", "--mass", "2", "--out", outDir()]), text)).rejects.toThrow(GLB_MESSAGES.textGltf);
    await expect(runOffline(options(["part.glb", "--mass", "2", "--out", outDir()]), new Uint8Array(40))).rejects.toBeInstanceOf(CliError);
  });
});

describe("crate CLI, through the API", () => {
  it("posts the GLB and fields with the key and writes the answer", async () => {
    const out = outDir();
    const offline = await runOffline(options([SAMPLE, "--mass", "21.5", "--out", outDir()]), bytes);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get("mass")).toBe("21.5");
      expect((form.get("file") as File).size).toBe(bytes.byteLength);
      expect(new Headers(init!.headers).get("authorization")).toBe("Bearer cdk_test");
      return Response.json(offline.report);
    });
    const { report, files } = await runOnline(
      options([SAMPLE, "--mass", "21.5", "--out", out, "--key", "cdk_test", "--api", "http://api"]),
      bytes,
      fetchImpl as typeof fetch,
    );
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api/api/v1/designs");
    expect(report).toEqual(offline.report);
    expect(files).toEqual(["designs.json", "ranking.csv"]);
    expect(readFileSync(join(out, "ranking.csv"), "utf8")).toBe(rankingCsv(report));
  });

  it("shows the API's error message", async () => {
    const fetchImpl = async () => Response.json({ error: { code: "unauthorized", message: "That API key isn't valid, or it was revoked." } }, { status: 401 });
    await expect(runOnline(options([SAMPLE, "--mass", "2", "--out", outDir()]), bytes, fetchImpl as typeof fetch)).rejects.toThrow(
      "That API key isn't valid, or it was revoked. (HTTP 401)",
    );
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(runOnline(options([SAMPLE, "--mass", "2", "--out", outDir()]), bytes, down as typeof fetch)).rejects.toThrow(/--offline/);
  });
});
