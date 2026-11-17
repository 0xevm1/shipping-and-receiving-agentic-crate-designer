// Save bodies for the load test (docs/LOAD_TEST.md): what the browser posts to
// `POST /api/v1/jobs/:id/configs`. The server recomputes every save and rejects a body the engine
// wouldn't produce, so the bodies come from the same engine (src/engine), run here up front.
// Each one has its own inputHash, so each save to a job adds a link and emits `config.added`.
//
//   bun scripts/load/bodies.ts <count>
//
// Prints `{ databaseUrl, bodies: [{ inputHash, json }] }` on stdout. `run.mjs` (Node) calls it:
// the engine and the env loading are TypeScript with path aliases, which Bun runs as is.
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS, RANKINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { designShipment } from "@/engine/engine";
import type { DesignRequest } from "@/engine/schemas";
import type { SaveConfigurationRequest } from "@/lib/api/jobs";
import { databaseUrl } from "@/server/db/config";

type SaveBody = { inputHash: string; json: string };

/** At least `count` distinct, saveable bodies: every catalog part × quantity × ranking. */
function saveBodies(count: number): SaveBody[] {
  const out: SaveBody[] = [];
  const seen = new Set<string>();
  for (let quantity = 1; out.length < count && quantity <= 500; quantity++) {
    for (const p of catalog.parts) {
      for (const ranking of RANKINGS) {
        if (out.length >= count) return out;
        const request: DesignRequest = {
          part: { id: p.id, name: p.name, mass_kg: p.mass_kg, dimensions_mm: p.dimensions_mm, material: p.material },
          settings: { ...DEFAULT_SETTINGS, quantity },
          standards: DEFAULT_STANDARDS,
          layoutKey: null,
          ranking,
        };
        const design = designShipment(request);
        if (!design.summary.crates.length || design.summary.problem || seen.has(design.inputHash)) continue;
        seen.add(design.inputHash);
        const body: SaveConfigurationRequest = { request, engineVersion: design.engineVersion, inputHash: design.inputHash, summary: design.summary };
        out.push({ inputHash: design.inputHash, json: JSON.stringify(body) });
      }
    }
  }
  if (out.length < count) throw new Error(`Only ${out.length} distinct save bodies; asked for ${count}. Lower --duration or raise --jobs.`);
  return out;
}

const count = Number(process.argv[2] ?? 100);
process.stdout.write(JSON.stringify({ databaseUrl: databaseUrl(), bodies: saveBodies(count) }));
