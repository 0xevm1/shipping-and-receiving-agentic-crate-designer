import { describe, expect, it } from "vitest";
import type { Check } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { allChecks, cautionCount, modelMatchesCatalog, MODEL_TOLERANCE_MM } from "./checks";

const catalogDims: Vec3 = [360, 220, 258];
const catalog = { catalogDims, readAsMm: false, massAssumed: false };
const domain = (id: Check["id"], level: Check["level"]): Check => ({ id, level, title: id, detail: [] });
const ids = (items: { id: string }[]) => items.map((c) => c.id);

describe("modelMatchesCatalog", () => {
  it("is null when there is nothing to compare", () => {
    expect(modelMatchesCatalog({ catalogDims }, null)).toBeNull();
    expect(modelMatchesCatalog({ catalogDims: undefined }, catalogDims)).toBeNull();
  });

  it("matches within the tolerance on every axis, and not beyond it", () => {
    expect(MODEL_TOLERANCE_MM).toBe(1);
    expect(modelMatchesCatalog({ catalogDims }, [360, 220, 258])).toBe(true);
    expect(modelMatchesCatalog({ catalogDims }, [361, 219, 258.5])).toBe(true);
    expect(modelMatchesCatalog({ catalogDims }, [362, 220, 258])).toBe(false);
    expect(modelMatchesCatalog({ catalogDims }, [360, 220, 256.9])).toBe(false);
  });
});

describe("allChecks", () => {
  it("passes the domain checks through, with nothing added when there is no measurement", () => {
    const items = allChecks([domain("door", "ok")], catalog, null);
    expect(items).toEqual([{ id: "door", level: "ok", title: "door", detail: [] }]);
  });

  it("adds an ok check when the model matches the catalog", () => {
    const items = allChecks([], catalog, [360, 220, 258]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "model", level: "ok", title: "3D model matches the catalog size" });
  });

  it("adds a caution when the model differs from the catalog", () => {
    const items = allChecks([], catalog, [400, 220, 258]);
    expect(items[0]).toMatchObject({ id: "model", level: "caution", title: "3D model does not match the catalog" });
  });

  it("adds an info note for a file with no catalog size, mentioning millimetres only when read as such", () => {
    const unknown = { catalogDims: undefined, readAsMm: false, massAssumed: false };
    const metres = allChecks([], unknown, [300, 200, 100])[0];
    expect(metres).toMatchObject({ id: "model", level: "info", title: "Size comes from the model file" });
    expect(JSON.stringify(metres.detail)).not.toContain("millimetres");
    const mm = allChecks([], { ...unknown, readAsMm: true }, [300, 200, 100])[0];
    expect(JSON.stringify(mm.detail)).toContain("reading the file as millimetres");
  });

  it("adds a caution for a stand-in mass", () => {
    const items = allChecks([], { ...catalog, massAssumed: true }, null);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "mass", level: "caution", title: "Part mass is a stand-in" });
  });

  it("sorts cautions first, then ok, then info, keeping order within a level", () => {
    const items = allChecks(
      [domain("door", "info"), domain("stack", "ok"), domain("lid", "caution"), domain("stable", "ok"), domain("forklift", "caution")],
      { ...catalog, massAssumed: true },
      [400, 220, 258],
    );
    expect(ids(items)).toEqual(["lid", "forklift", "model", "mass", "stack", "stable", "door"]);
  });

  it("does not modify the domain checks it was given", () => {
    const input = [domain("door", "info"), domain("lid", "caution")];
    allChecks(input, { ...catalog, massAssumed: true }, null);
    expect(ids(input)).toEqual(["door", "lid"]);
  });
});

describe("cautionCount", () => {
  it("counts only cautions", () => {
    expect(cautionCount([{ level: "caution" }, { level: "ok" }, { level: "info" }, { level: "caution" }])).toBe(2);
    expect(cautionCount([])).toBe(0);
  });
});
