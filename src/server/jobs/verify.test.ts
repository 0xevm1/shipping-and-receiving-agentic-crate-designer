import { describe, expect, it } from "vitest";
import { catalog } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { designShipment } from "@/engine/engine";
import type { DesignRequest } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import { ApiFailure } from "../http";
import { verifyConfiguration } from "./verify";

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

function failure(f: () => unknown): ApiFailure {
  try {
    f();
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

describe("verifyConfiguration", () => {
  it("accepts the engine's own answer, whatever order the summary's keys arrive in", () => {
    const b = body();
    b.summary = Object.fromEntries(Object.entries(b.summary).reverse());
    const { design } = verifyConfiguration(b);
    expect(design.inputHash).toBe(out.inputHash);
    expect(design.engineVersion).toBe(ENGINE_VERSION);
  });

  it("refuses another engine version with 409 before running anything", () => {
    const f = failure(() => verifyConfiguration({ ...body(), engineVersion: "old" }));
    expect([f.status, f.code, f.extra]).toEqual([409, "engine_version_mismatch", { engineVersion: ENGINE_VERSION }]);
  });

  it("refuses a changed hash, summary or request with 422", () => {
    expect(failure(() => verifyConfiguration({ ...body(), inputHash: "f".repeat(64) })).code).toBe("result_mismatch");
    const s = body();
    s.summary.totals.grossKg += 1;
    expect(failure(() => verifyConfiguration(s))).toMatchObject({ status: 422, field: "summary" });
    const r = body();
    r.request.settings.quantity = 5;
    expect(failure(() => verifyConfiguration(r))).toMatchObject({ status: 422, field: "inputHash" });
  });

  it("refuses a request the engine can't read with 400", () => {
    const b = body();
    delete b.request.part;
    expect(failure(() => verifyConfiguration(b))).toMatchObject({ status: 400, code: "invalid_request" });
  });
});
