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
