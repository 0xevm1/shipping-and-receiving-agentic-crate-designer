import { describe, expect, it } from "vitest";
import { restoreDesign } from "@/domain/designFile";
import { partKey } from "@/domain/designLibrary";
import { readShareHash, shareHash } from "@/domain/shareLink";
import { useDesigner } from "@/state/store";
import { currentDesignFile } from "./currentDesign";

describe("currentDesignFile (#14)", () => {
  it("writes the design on screen and survives a share link round trip unchanged", () => {
    const s = useDesigner.getState();
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
    const s = useDesigner.getState();
    expect(currentDesignFile({ ...s, result: { ...s.result, design: null } })).toBeNull();
  });
});
