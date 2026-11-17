import { beforeEach, describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { catalogPart, useDesigner, type LoadedPart } from "./store";

/** An unknown part as `loadPartFiles` builds it: stand-in mass, no material. */
const unknownPart: LoadedPart = {
  id: "widget",
  name: "Widget",
  mass_kg: 10,
  dimensions_mm: [300, 200, 100],
  suggested_quantities: [1, 4, 8],
  modelUrl: "blob:widget",
  mmPerUnit: 1000,
  massAssumed: true,
  readAsMm: false,
};

const initial = useDesigner.getState();
const s = () => useDesigner.getState();

describe("setPartDetails", () => {
  beforeEach(() => {
    useDesigner.setState(initial, true);
    s().setPart(unknownPart);
  });

  it("sets the name and material without touching the layout", () => {
    const keys = s().result.layouts.map((l) => l.key);
    s().setLayoutKey(keys[keys.length - 1]);
    const fit = s().fit.nonce;

    expect(s().setPartDetails({ name: "Gear housing", material: "6061-T6 aluminum" })).toBeNull();
    expect(s().part).toMatchObject({ name: "Gear housing", material: "6061-T6 aluminum", mass_kg: 10, massAssumed: true });
    expect(s().layoutKey).toBe(keys[keys.length - 1]);
    expect(s().fit.nonce).toBe(fit);
  });

  it("clears the material when it is blanked", () => {
    s().setPartDetails({ material: "4140 steel" });
    s().setPartDetails({ material: "" });
    expect(s().part.material).toBeUndefined();
  });

  it("recomputes the design and drops the stand-in flag when a mass is entered", () => {
    const before = s().result.design!.payloadKg;
    expect(s().setPartDetails({ mass_kg: 25 })).toBeNull();
    expect(s().part.massAssumed).toBe(false);
    expect(s().result.design!.payloadKg).toBe((before / 10) * 25);
  });

  it("accepts the stand-in value itself as a real mass", () => {
    s().setPartDetails({ mass_kg: 10 });
    expect(s().part.massAssumed).toBe(false);
  });

  it("rejects invalid input and changes nothing", () => {
    const part = s().part;
    expect(s().setPartDetails({ name: " " })).toMatch(/name/);
    expect(s().setPartDetails({ mass_kg: 0 })).toMatch(/Mass/);
    expect(s().setPartDetails({ name: "Ok", mass_kg: -2 })).not.toBeNull();
    expect(s().part).toBe(part);
  });

  it("keeps catalog parts read-only", () => {
    s().setPart(catalogPart(getPart("PART-001")));
    const part = s().part;
    expect(s().setPartDetails({ name: "Renamed" })).not.toBeNull();
    expect(s().part).toBe(part);
  });
});

describe("lastChange", () => {
  beforeEach(() => {
    useDesigner.setState(initial, true);
    s().setPart({ ...unknownPart, dimensions_mm: [1, 1, 1] });
  });

  it("is cleared by loading a part", () => {
    expect(s().lastChange).toBeNull();
  });

  it("records a mass edit's diff and source", () => {
    s().setPartDetails({ mass_kg: 14.71 });
    const c = s().lastChange!;
    expect(c.source).toBe("mass");
    expect(c.changes.map((x) => x.field)).toEqual(["gross", "payload"]);
    const gross = c.changes[0];
    expect([Math.round(gross.from as number), Math.round(gross.to as number)]).toEqual([16, 20]);
  });

  it("records a name or material edit as a change with nothing moved", () => {
    s().setPartDetails({ material: "4140 steel" });
    expect(s().lastChange).toMatchObject({ source: "material", changes: [] });
    const id = s().lastChange!.id;
    s().setPartDetails({ name: "Cover" });
    expect(s().lastChange).toMatchObject({ source: "name", changes: [], id: id + 1 });
  });

  it("records rules and layout edits, but not units", () => {
    s().setSettings({ quantity: 4 });
    expect(s().lastChange?.source).toBe("rules");
    expect(s().lastChange?.changes.map((x) => x.field)).toContain("grid");
    const before = s().lastChange;
    s().setUnits("imperial");
    expect(s().lastChange).toBe(before);
    s().setLayoutKey(s().result.layouts[s().result.layouts.length - 1].key);
    expect(s().lastChange?.source).toBe("layout");
  });

  it("leaves nothing to compare when the design becomes a problem", () => {
    s().setPart({ ...unknownPart, dimensions_mm: [30_000, 1, 1] });
    s().setPartDetails({ mass_kg: 5 });
    expect(s().lastChange).toBeNull();
  });
});
