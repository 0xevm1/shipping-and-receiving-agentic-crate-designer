import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { restoreDesign } from "@/domain/designFile";
import { partKey } from "@/domain/designLibrary";
import { planShipment } from "@/domain/shipment";
import { readShareHash, shareHash } from "@/domain/shareLink";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { currentDesignFile } from "./currentDesign";
import { catalogPart } from "./part";

/** The designer's default state: the preloaded part at the default rules. */
function defaults() {
  const part = catalogPart(getPart("PART-001"));
  const plan = planShipment(part, DEFAULT_SETTINGS, null, DEFAULT_STANDARDS);
  return { part, settings: DEFAULT_SETTINGS, standards: DEFAULT_STANDARDS, plan, result: plan.crates[0].result, ranking: "volume" as const };
}

describe("currentDesignFile (#14)", () => {
  it("writes the design on screen and survives a share link round trip unchanged", () => {
    const s = defaults();
    const file = currentDesignFile(s, "2026-11-16T12:00:00.000Z")!;
    expect(file.part).toMatchObject({ source: "catalog", id: "PART-001" });
    expect(file.summary.outsideMm).toEqual([932, 652, 497]);
    expect(partKey(file.part)).toBe("catalog:PART-001:PART-001-machined-steel-bracket.glb");

    const back = readShareHash(shareHash(file));
    expect(back).toEqual({ ok: true, file });
    if (!back?.ok) return;
    const restored = restoreDesign(back.file, s.part, s.standards);
    expect(restored).toEqual({ settings: s.settings, layoutKey: file.layoutKey, ranking: "volume", notes: [], crateIndex: 0 });
  });

  it("is null when there is no crate", () => {
    const s = defaults();
    expect(currentDesignFile({ ...s, result: { ...s.result, design: null } })).toBeNull();
  });
});
