import { beforeEach, describe, expect, it } from "vitest";
import type { LoadedPart } from "@/lib/part";
import { designPartBody } from "./jobSync";
import { useDesigner } from "./store";

/** The part's centre of gravity in the design store (#110). */
const widget: LoadedPart = {
  id: "widget",
  name: "Widget",
  mass_kg: 300,
  dimensions_mm: [1000, 200, 100],
  suggested_quantities: [1, 4, 8],
  modelUrl: "blob:widget-cog",
  modelUnits: "m",
  upAxis: "z",
  unitsGuessed: false,
  mmPerUnit: 1000,
  rawSize: [1, 0.2, 0.1],
  massAssumed: false,
};

const initial = useDesigner.getState();
const s = () => useDesigner.getState();
const basis = () => s().result.design!.handling.cogBasis;

describe("the part's centre of gravity in the store", () => {
  beforeEach(() => {
    useDesigner.setState(initial, true);
    s().setPart(widget);
  });

  it("is assumed at the box centre until one is estimated or supplied", () => {
    expect(s().part.cog).toBeUndefined();
    expect(basis()).toBe("assumed");
  });

  it("takes the mesh estimate for the model that is loaded, and the design follows it", () => {
    const before = s().result.design!.handling.offsetMm[0];
    s().setPartCog("blob:widget-cog", { offsetMm: [300, 0, 0] });
    expect(s().part.cog).toEqual({ offsetMm: [300, 0, 0], source: "estimated" });
    expect(basis()).toBe("estimated");
    expect(s().result.design!.handling.offsetMm[0]).toBeGreaterThan(before + 50);
    // It is in the request the server is sent with the job's part.
    expect(designPartBody(s().part).cog).toEqual({ offsetMm: [300, 0, 0], source: "estimated" });
  });

  it("ignores an estimate for another model, and never replaces a centre that is already there", () => {
    s().setPartCog("blob:other", { offsetMm: [300, 0, 0] });
    expect(s().part.cog).toBeUndefined();
    expect(s().setPartCogOffset([100, 0, 0])).toBeNull();
    s().setPartCog("blob:widget-cog", { offsetMm: [300, 0, 0] });
    expect(s().part.cog).toEqual({ offsetMm: [100, 0, 0], source: "supplied" });
  });

  it("keeps the reason when the mesh gives no centre, and the check says it is assumed", () => {
    s().setPartCog("blob:widget-cog", { fallback: "open" });
    expect(s().cogFallback).toEqual({ modelUrl: "blob:widget-cog", reason: "open" });
    expect(s().part.cog).toBeUndefined();
    expect(basis()).toBe("assumed");
  });

  it("lets the person supply one (inside the box only), and clearing it goes back to assumed", () => {
    expect(s().setPartCogOffset([600, 0, 0])).toMatch(/inside the part's box/);
    expect(s().part.cog).toBeUndefined();
    expect(s().setPartCogOffset([250, 20, -10])).toBeNull();
    expect(s().part.cog).toEqual({ offsetMm: [250, 20, -10], source: "supplied" });
    expect(basis()).toBe("supplied");
    expect(s().setPartCogOffset(null)).toBeNull();
    expect(s().part.cog).toBeUndefined();
    expect(basis()).toBe("assumed");
  });

  it("refuses to edit a catalog part's centre", () => {
    s().setPart({ ...widget, catalogDims: [1000, 200, 100] });
    expect(s().setPartCogOffset([1, 0, 0])).toBe("Catalog parts can't be edited.");
  });

  it("keeps the same point of the part when the file is read another way", () => {
    // A 0.3 x 0.2 x 0.1 file, Z up: the point is (100, 50, 20) mm from the middle along the file's axes.
    // Read as Y up the same point is (x, -z, y) of those axes: (100, -20, 50) in the design frame.
    const loaded: LoadedPart = { ...widget, rawSize: [0.3, 0.2, 0.1], dimensions_mm: [300, 200, 100], modelUrl: "blob:reframe" };
    s().setPart(loaded);
    s().setPartCogOffset([100, 50, 20]);
    expect(s().setPartFrame({ up: "y" })).toBeNull();
    expect(s().part.cog?.offsetMm).toEqual([100, -20, 50]);
    expect(s().part.cog?.source).toBe("supplied");
    // A frame change clears the old reason.
    expect(s().cogFallback).toBeNull();
  });
});
