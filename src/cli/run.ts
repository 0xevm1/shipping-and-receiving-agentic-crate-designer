/**
 * What `bun run crate` does (#46 slice 7): the headless calculation, through the API
 * (`POST /api/v1/designs`) or in this process (`--offline`), and the files it writes.
 *
 * Both write `designs.json` (the API's answer: ranked configurations, recommendation, curve, total
 * plan) and `ranking.csv`. Offline, the engine's file builders also run here, so the recommended
 * design's download package lands too: the crate GLB, the PDF, the cut list CSV, design.json and
 * README, as the app's "Download all" makes them.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { unzipSync } from "fflate";
import { GLB_MESSAGES, glbProblem, glbSizeUnits, idFromFile, looksLikeTextGltf, MAX_GLB_BYTES, nameFromFile, unitsToMm } from "@/domain/glb";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { designShipment } from "@/engine/engine";
import { buildBundleZip } from "@/engine/files";
import { bytesModelReader } from "@/engine/glb";
import { sha256Hex } from "@/engine/sha256";
import { DEFAULT_SWEEP_RULES, rankConfigurations, sweepDesignRequest, type SweepRequest } from "@/engine/sweep";
import { type DesignsApiResponse, DesignsApiResponseSchema } from "@/lib/api/designs";
import { ApiErrorSchema } from "@/lib/api/parts";
import type { LoadedPart } from "@/lib/part";
import type { CliOptions } from "./args";

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/** The checks the app and the API make on a GLB, with their messages. */
function checkGlb(bytes: Uint8Array, fileName: string): void {
  if (bytes.byteLength > MAX_GLB_BYTES) throw new CliError(GLB_MESSAGES.tooLarge);
  if (/\.gltf$/i.test(fileName) || looksLikeTextGltf(bytes)) throw new CliError(GLB_MESSAGES.textGltf);
  const problem = glbProblem(bytes);
  if (problem) throw new CliError(problem);
}

export interface RunResult {
  report: DesignsApiResponse;
  /** Files written, relative to the output directory. */
  files: string[];
}

/** Runs the engine here: sweep, shortlist, and the recommended design's files. */
export async function runOffline(opts: CliOptions, bytes: Uint8Array, now = new Date()): Promise<RunResult> {
  const fileName = basename(opts.file);
  checkGlb(bytes, fileName);
  const sizeUnits = glbSizeUnits(bytes);
  if (!sizeUnits) throw new CliError(GLB_MESSAGES.noGeometry);
  const { sizeMm, readAsMm, mmPerUnit } = unitsToMm(sizeUnits);
  const sha256 = sha256Hex(bytes);
  const req: SweepRequest = {
    part: {
      id: idFromFile(fileName),
      name: opts.name ?? nameFromFile(fileName),
      mass_kg: opts.massKg,
      dimensions_mm: sizeMm,
      material: opts.material ?? undefined,
    },
    rules: DEFAULT_SWEEP_RULES,
    standards: DEFAULT_STANDARDS,
    freightRates: opts.freightRates,
    total: opts.total,
  };
  const report: DesignsApiResponse = { ...rankConfigurations(req), model: { sha256, sizeBytes: bytes.byteLength, readAsMm } };
  const files = await writeReport(opts.out, report);

  const best = report.configurations[0];
  if (best) {
    // With a total, the package is for the whole batch (split evenly, #25); otherwise one crate.
    const design = report.total ? sweepDesignRequest(req, report.total.total, null) : sweepDesignRequest(req, best.quantityPerCrate, best.layoutKey);
    const { plan } = designShipment(design);
    const part: LoadedPart = { ...design.part, modelUrl: "", model: fileName, mmPerUnit, suggested_quantities: [], massAssumed: false, readAsMm };
    const glb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const bundle = await buildBundleZip({ ...design, part, plan, crateIndex: 0, units: "metric", generatedAt: now.toISOString() }, bytesModelReader(glb));
    for (const [name, data] of Object.entries(unzipSync(bundle.zip))) {
      await writeFile(join(opts.out, name), data);
      files.push(name);
    }
  }
  return { report, files };
}

/** Calls `POST /api/v1/designs` and writes its answer. */
export async function runOnline(opts: CliOptions, bytes: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<RunResult> {
  const form = new FormData();
  form.set("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" }), basename(opts.file));
  for (const [k, v] of Object.entries(opts.fields)) form.set(k, v);
  let res: Response;
  try {
    res = await fetchImpl(`${opts.api}/api/v1/designs`, {
      method: "POST",
      body: form,
      headers: opts.key ? { Authorization: `Bearer ${opts.key}` } : {},
    });
  } catch (e) {
    throw new CliError(`Couldn't reach ${opts.api} (${(e as Error).message}). Is the app running? Or use --offline.`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(body);
    throw new CliError(err.success ? `${err.data.error.message} (HTTP ${res.status})` : `The API answered HTTP ${res.status}.`);
  }
  const report = DesignsApiResponseSchema.parse(body);
  return { report, files: await writeReport(opts.out, report) };
}

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The ranked shortlist as CSV, one row per configuration, best first. */
export function rankingCsv(report: DesignsApiResponse): string {
  const head = [
    "rank",
    "quantity_per_crate",
    "layout",
    "usd_per_part",
    "crate_cost_usd",
    "freight_usd",
    "gross_kg",
    "outside_x_mm",
    "outside_y_mm",
    "outside_z_mm",
    "input_hash",
  ];
  const rows = report.configurations.map((c) => [
    c.rank,
    c.quantityPerCrate,
    c.layoutKey,
    c.scoreUsdPerPart.toFixed(2),
    c.crateCostUsd.toFixed(2),
    c.freightUsd === null ? "" : c.freightUsd.toFixed(2),
    c.grossKg.toFixed(1),
    ...(c.outsideMm ? c.outsideMm.map((v) => Math.round(v)) : ["", "", ""]),
    c.inputHash,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

async function writeReport(out: string, report: DesignsApiResponse): Promise<string[]> {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "designs.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(join(out, "ranking.csv"), rankingCsv(report));
  return ["designs.json", "ranking.csv"];
}

/** A few lines for the terminal. */
export function summaryText(report: DesignsApiResponse): string {
  if (report.problem) return `${report.problem.title}. ${report.problem.detail}`;
  const rec = report.recommendation;
  if (!rec) return "No quantity per crate passes the hard checks.";
  const lines = [`Recommended: ${rec.quantityPerCrate} per crate. ${rec.rationale}`];
  if (report.total) {
    const t = report.total;
    lines.push(
      `${t.total} parts: ${t.crates} crate(s) (${t.types.map((x) => `${x.count} × ${x.quantity}`).join(" + ")}), $${t.scoreUsdPerPart.toFixed(2)} a part.`,
    );
  } else if (report.configurations.length === 0) {
    lines.push("No configuration passes.");
  }
  return lines.join("\n");
}
