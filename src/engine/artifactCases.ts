import { catalog } from "@/domain/catalog";
import { buildArtifact, sweepFor } from "./artifacts";
import { parityRequest } from "./parityCases";
import type { DesignRequest } from "./schemas";
import { ENGINE_VERSION } from "./version";

/**
 * The artifact parity cases (spec §7.17, §10): every sample part at its recommended quantity and
 * layout. `artifacts.node.test.ts` and `artifacts.jsdom.test.ts` both compare the CSV artifacts
 * against one committed baseline, `__snapshots__/artifacts-csv.txt`, so the two runtimes write
 * byte-identical files.
 */
export function recommendedRequest(id: string): DesignRequest {
  const req = parityRequest(id, 1);
  const rec = sweepFor(req).recommendation!;
  return { ...req, settings: { ...req.settings, quantity: rec.quantity }, layoutKey: rec.crate.layoutKey };
}

/** The engine version is replaced by `<engine>`, so the baseline doesn't change with every release. */
export async function artifactCsvText(): Promise<string> {
  const out: string[] = [];
  for (const p of catalog.parts) {
    const a = await buildArtifact("csv", { ...recommendedRequest(p.id), units: "imperial" }, null);
    out.push(`==> ${a.fileName} ${a.inputHash}`, new TextDecoder().decode(a.bytes).replaceAll(ENGINE_VERSION, "<engine>"));
  }
  return out.join("\n");
}
