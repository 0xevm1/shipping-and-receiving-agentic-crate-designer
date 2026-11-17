import { beforeEach, describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import type { PartProfile } from "@/domain/profile";
import { useDesigner } from "./store";
import { catalogPart, type LoadedPart } from "@/lib/part";

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

    expect(s().setPartDetails({ name: "Gear housing", material: "6061-T6 aluminum" })).toBeNull();
    expect(s().part).toMatchObject({ name: "Gear housing", material: "6061-T6 aluminum", mass_kg: 10, massAssumed: true });
    expect(s().layoutKey).toBe(keys[keys.length - 1]);
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

describe("loadDesign", () => {
  beforeEach(() => useDesigner.setState(initial, true));

  it("keeps the saved settings and layout instead of resetting them like setPart", () => {
    const shaft = catalogPart(getPart("PART-002"));
    const settings = { ...s().settings, quantity: 6, maxLayers: 3, partGapMm: 20 };
    s().loadDesign(shaft, settings, null);
    const keys = s().result.layouts.map((l) => l.key);
    const pick = keys[keys.length - 1];
    s().loadDesign(shaft, settings, pick);
    expect(s().part.id).toBe("PART-002");
    expect(s().settings).toEqual(settings);
    expect(s().layoutKey).toBe(pick);
    expect(s().result.design?.layout.key).toBe(pick);
  });
});

describe("setPartProfile", () => {
  beforeEach(() => {
    useDesigner.setState(initial, true);
    s().setPart(unknownPart);
  });

  /** The widget's profile: flat, except the −X face is set back 30 mm above half height. */
  const profile = (): PartProfile => {
    const face = (cols: number, rows: number, depth: (r: number) => number = () => 0) => ({
      cols,
      rows,
      depth: Array.from({ length: cols * rows }, (_, i) => depth(Math.floor(i / cols))),
    });
    return {
      version: 1,
      sizeMm: [300, 200, 100],
      cellMm: 5,
      faces: {
        "-x": face(40, 20, (r) => (r >= 10 ? 30 : 0)),
        "+x": face(40, 20),
        "-y": face(60, 20),
        "+y": face(60, 20),
        "-z": face(60, 40),
        "+z": face(60, 40),
      },
    };
  };

  it("shapes the blocking and keeps the layout pick", () => {
    const keys = s().result.layouts.map((l) => l.key);
    s().setLayoutKey(keys[keys.length - 1]);
    expect(s().result.design!.shapedBlocking).toBeUndefined();

    s().setPartProfile("blob:widget", profile());
    expect(s().part.profile).toBeDefined();
    expect(s().result.design!.shapedBlocking).toBeDefined();
    expect(s().layoutKey).toBe(keys[keys.length - 1]);
  });

  it("ignores a profile for a model that is no longer loaded, or a failed analysis", () => {
    s().setPartProfile("blob:other", profile());
    s().setPartProfile("blob:widget", null);
    expect(s().part.profile).toBeUndefined();
    expect(s().result.design!.shapedBlocking).toBeUndefined();
  });

  it("keeps the profile through a mass edit, and drops it with a new part", () => {
    s().setPartProfile("blob:widget", profile());
    s().setPartDetails({ name: "Housing", mass_kg: 12 });
    expect(s().result.design!.shapedBlocking).toBeDefined();
    s().setPart({ ...unknownPart, modelUrl: "blob:next" });
    expect(s().result.design!.shapedBlocking).toBeUndefined();
  });
});
