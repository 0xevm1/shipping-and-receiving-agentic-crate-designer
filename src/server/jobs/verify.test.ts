import { describe, expect, it } from "vitest";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { designShipment } from "@/engine/engine";
import type { DesignRequest } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import { ApiFailure } from "../http";
import { checkConfiguration } from "./check";
import { verifyConfiguration as verifyWith } from "./verify";

const part = catalog.parts[0]!;
const request: DesignRequest = {
  part: { id: part.id, name: part.name, mass_kg: part.mass_kg, dimensions_mm: part.dimensions_mm, material: part.material },
  settings: { ...DEFAULT_SETTINGS, quantity: 4 },
  standards: DEFAULT_STANDARDS,
  layoutKey: null,
  ranking: "volume",
};
const out = designShipment(request);
/** As it arrives over the wire. */
const body = () => JSON.parse(JSON.stringify({ request, engineVersion: out.engineVersion, inputHash: out.inputHash, summary: out.summary }));

/** The check as the engine thread runs it, counted, and as structured clones (what crosses `postMessage`). */
let checks = 0;
const verifyConfiguration = (b: Parameters<typeof verifyWith>[0]) =>
  verifyWith(b, async (input) => {
    checks++;
    return structuredClone(checkConfiguration(structuredClone(input)));
  });

async function failure(f: () => Promise<unknown>): Promise<ApiFailure> {
  try {
    await f();
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

describe("verifyConfiguration", () => {
  it("accepts the engine's own answer, whatever order the summary's keys arrive in", async () => {
    const b = body();
    b.summary = Object.fromEntries(Object.entries(b.summary).reverse());
    const { design, request: parsed } = await verifyConfiguration(b);
    expect(design.inputHash).toBe(out.inputHash);
    expect(design.engineVersion).toBe(ENGINE_VERSION);
    expect(design.summary).toEqual(out.summary);
    expect(parsed).toEqual(request);
  });

  it("returns only what the save stores from the thread, not the full plan", () => {
    const result = checkConfiguration(body());
    expect(result.ok && Object.keys(result.design).sort()).toEqual(["engineVersion", "inputHash", "summary"]);
  });

  it("refuses another engine version with 409 before running anything", async () => {
    const before = checks;
    const f = await failure(() => verifyConfiguration({ ...body(), engineVersion: "old" }));
    expect([f.status, f.code, f.extra]).toEqual([409, "engine_version_mismatch", { engineVersion: ENGINE_VERSION }]);
    expect(checks).toBe(before);
  });

  it("refuses a changed hash, summary or request with 422", async () => {
    expect((await failure(() => verifyConfiguration({ ...body(), inputHash: "f".repeat(64) }))).code).toBe("result_mismatch");
    const s = body();
    s.summary.totals.grossKg += 1;
    expect(await failure(() => verifyConfiguration(s))).toMatchObject({ status: 422, field: "summary" });
    const r = body();
    r.request.settings.quantity = 5;
    expect(await failure(() => verifyConfiguration(r))).toMatchObject({ status: 422, field: "inputHash" });
  });

  it("refuses a request the engine can't read with 400", async () => {
    const b = body();
    delete b.request.part;
    expect(await failure(() => verifyConfiguration(b))).toMatchObject({ status: 400, code: "invalid_request" });
  });
});
