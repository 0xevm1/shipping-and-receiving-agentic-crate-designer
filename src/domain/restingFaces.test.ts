import { describe, expect, it } from "vitest";
import { getPart, parts } from "./catalog";
import { computeDesign, DEFAULT_SETTINGS, rankLayouts, type DesignPart } from "./design";
import {
  ANY_FACES,
  AS_MODELLED_FACES,
  canonicalFaces,
  isFlipped,
  ORIENTATIONS,
  orientationsFor,
  restingFace,
  RESTING_FACES,
  type RestingFace,
} from "./orientations";
import { describeFaces, FACE_NAMES, faceSize, layDownOffer, presetFaces, restingPreset, toggleFace } from "./restingFaces";
import { CrateSettingsSchema, normalizeSettings } from "./schema";
import { planShipment } from "./shipment";
import { settings } from "./testFixtures";

/** The tall-part scenario (`fixtures/scenarios/tall-part.glb`): a post, 150 × 150 × 1,200 mm, 12 kg. */
const POST: DesignPart = { id: "SCN-920", name: "Post", mass_kg: 12, dimensions_mm: [150, 150, 1200] };

const cautions = (checks: { id: string; level: string }[]) => checks.filter((c) => c.level === "caution").map((c) => c.id);

describe("the faces a part may rest on", () => {
  it("names the face that is down in every orientation: all six faces, each in a turned and an unturned orientation", () => {
    expect(ORIENTATIONS).toHaveLength(12);
    for (const face of RESTING_FACES) expect(ORIENTATIONS.filter((o) => restingFace(o) === face)).toHaveLength(2);
    // The six orientations saved layout keys already named keep their order, and so their faces.
    expect(ORIENTATIONS.slice(0, 6).map(restingFace)).toEqual(["-z", "-z", "-y", "-x", "+x", "-y"]);
    expect(ORIENTATIONS.slice(0, 6).some(isFlipped)).toBe(false);
    expect(ORIENTATIONS.slice(6).every(isFlipped)).toBe(true);
  });

  it("an orientation and its flip have the same extents, so a flipped face adds no new layout shapes", () => {
    for (const face of RESTING_FACES) {
      const dims = orientationsFor([face]).map((o) => o.id);
      expect(dims).toHaveLength(2);
    }
    expect(orientationsFor(ANY_FACES)).toEqual(ORIENTATIONS);
    expect(orientationsFor(AS_MODELLED_FACES).map((o) => o.id)).toEqual(["as-modeled", "turned"]);
  });

  it("puts a set of faces in the canonical order, and refuses an empty or unknown one", () => {
    expect(canonicalFaces(["+x", "-z", "+x"])).toEqual(["-z", "+x"]);
    expect(canonicalFaces([])).toBeNull();
    expect(canonicalFaces(["-z", "up"])).toBeNull();
  });

  describe("presets", () => {
    it("any is all six faces, as modelled is the model's own base, anything else is choose", () => {
      expect(restingPreset(ANY_FACES)).toBe("any");
      expect(restingPreset(AS_MODELLED_FACES)).toBe("modelled");
      expect(restingPreset(["-z", "-y"])).toBe("choose");
      expect(restingPreset(["+z"])).toBe("choose");
      expect(presetFaces("any", ["-z"])).toEqual([...RESTING_FACES]);
      expect(presetFaces("modelled", ["-y"])).toEqual(["-z"]);
      expect(presetFaces("choose", ["-y", "+x"])).toEqual(["-y", "+x"]);
    });

    it("the default rule is as modelled", () => {
      expect(restingPreset(DEFAULT_SETTINGS.restingFaces)).toBe("modelled");
    });

    it("toggling keeps the canonical order and never leaves no face", () => {
      expect(toggleFace(["-z"], "-x", true)).toEqual(["-z", "-x"]);
      expect(toggleFace(["-z", "+y"], "+y", false)).toEqual(["-z"]);
      expect(toggleFace(["-z"], "-z", false)).toEqual(["-z"]);
    });

    it("the settings boundary takes a list of faces and keeps the current rule for anything else", () => {
      const base = settings();
      expect(normalizeSettings({ restingFaces: ["+x", "-y"] }, base).restingFaces).toEqual(["-y", "+x"]);
      for (const bad of [[], ["sideways"], "any", null, 3]) {
        expect(normalizeSettings({ restingFaces: bad } as never, base).restingFaces).toEqual(base.restingFaces);
      }
    });
  });

  describe("naming a face so it can be told from the others", () => {
    it("gives each face its place on the part as modelled and its size, longer side first", () => {
      expect(Object.values(FACE_NAMES)).toEqual(["Bottom", "Top", "Front", "Back", "Left", "Right"]);
      const dims: [number, number, number] = [360, 220, 90];
      expect(faceSize("-z", dims)).toEqual([360, 220]);
      expect(faceSize("+z", dims)).toEqual([360, 220]);
      expect(faceSize("-y", dims)).toEqual([360, 90]);
      expect(faceSize("+x", dims)).toEqual([220, 90]);
    });

    it("says the rule in a phrase", () => {
      expect(describeFaces(AS_MODELLED_FACES)).toBe("parts kept upright");
      expect(describeFaces(ANY_FACES)).toBe("parts may rest on any face");
      expect(describeFaces(["-y", "+y"])).toBe("parts rest only on the front, back faces");
      expect(describeFaces(["+x"])).toBe("parts rest only on the right face");
    });
  });
});

describe("every layout rests the part on an allowed face", () => {
  const sample = [...parts.map((p) => ({ id: p.id, part: p as DesignPart })), { id: POST.id, part: POST }];

  it.each(RESTING_FACES)("with only the %s face allowed, every layout rests the part on it", (face) => {
    for (const { part } of sample) {
      for (const quantity of [1, 4, 8]) {
        const layouts = rankLayouts(part, settings({ quantity, restingFaces: [face] }));
        expect(layouts.length).toBeGreaterThan(0);
        for (const layout of layouts) expect(restingFace(layout.orientation)).toBe(face);
      }
    }
  });

  it("with a chosen set, every layout rests on one of them, and each allowed axis is used", () => {
    const allowed: RestingFace[] = ["-y", "+x"];
    const layouts = rankLayouts(getPart("PART-002"), settings({ quantity: 4, restingFaces: allowed, maxLayers: 3 }));
    expect(layouts.every((l) => allowed.includes(restingFace(l.orientation)))).toBe(true);
    expect(new Set(layouts.map((l) => restingFace(l.orientation))).size).toBe(2);
  });

  it("the recommended design and its drawn orientation follow the rule too", () => {
    for (const face of ["+z", "-x", "+y"] as const) {
      const d = computeDesign(POST, settings({ quantity: 2, restingFaces: [face] })).design!;
      expect(restingFace(d.layout.orientation)).toBe(face);
    }
  });

  it("as modelled gives exactly the layouts Keep parts upright on gave, and any exactly those it gave off", () => {
    // Layout keys are what saved designs name: they must not change for either old setting.
    const keys = (restingFaces: readonly RestingFace[]) => rankLayouts(getPart("PART-003"), settings({ quantity: 8, restingFaces })).map((l) => l.key);
    const upright = keys(AS_MODELLED_FACES);
    expect(upright.every((k) => k.startsWith("u:"))).toBe(true);
    const any = keys(ANY_FACES);
    expect(any.filter((k) => k.startsWith("u:")).sort()).toEqual([...upright].sort());
    expect(any.some((k) => k.startsWith("s:"))).toBe(true);
    // The opposite faces repeat the same shapes, so they add none.
    expect(any.some((k) => k.startsWith("fu:") || k.startsWith("fs:"))).toBe(false);
  });

  it("a face only the flipped orientations rest on still gives layouts, keyed apart from the unflipped ones", () => {
    const keys = rankLayouts(POST, settings({ quantity: 2, restingFaces: ["+z"] })).map((l) => l.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith("fu:"))).toBe(true);
  });
});

describe("the offer to lay the parts down", () => {
  const plan = (restingFaces: readonly RestingFace[], part = POST) => planShipment(part, settings({ quantity: 1, restingFaces }));
  const offerFor = (restingFaces: readonly RestingFace[], part = POST) =>
    layDownOffer({ part, settings: settings({ quantity: 1, restingFaces }), plan: plan(restingFaces, part), crateIndex: 0 });

  it("the tall part standing up is top-heavy and tips over", () => {
    expect(cautions(plan(AS_MODELLED_FACES).crates[0].result.design!.checks)).toEqual(expect.arrayContaining(["stable", "cog-tip"]));
  });

  it("offers the lying-down layout for the tall part, and taking it clears both cautions", () => {
    const offer = offerFor(AS_MODELLED_FACES)!;
    expect(offer).not.toBeNull();
    expect(offer.lyingDown).toBe(true);
    expect(offer.restingFaces).toEqual(expect.arrayContaining(["-z"]));
    expect(offer.added.length).toBeGreaterThan(0);
    // The crate it promises is the crate the app shows once the rule is taken.
    const taken = planShipment(POST, settings({ quantity: 1, restingFaces: offer.restingFaces })).crates[0].result.design!;
    expect(cautions(taken.checks)).not.toContain("stable");
    expect(cautions(taken.checks)).not.toContain("cog-tip");
    expect(taken.layout.stable).toBe(true);
    expect([...taken.layout.external]).toEqual(offer.outsideMm);
    expect(taken.layout.orientation.label).toBe(offer.orientationLabel);
    // Lying down: the long side is no longer vertical.
    expect(taken.layout.external[2]).toBeLessThan(taken.layout.external[0]);
  });

  it("offers nothing when the rule already lets the part lie down: the recommended crate is the stable one", () => {
    expect(cautions(plan(["-z", "-y"]).crates[0].result.design!.checks)).not.toContain("stable");
    expect(offerFor(["-z", "-y"])).toBeNull();
  });

  it("widens the rule by one axis at a time rather than allowing every face", () => {
    const slab: DesignPart = { id: "S", name: "Slab", mass_kg: 12, dimensions_mm: [150, 300, 1200] };
    const offer = offerFor(AS_MODELLED_FACES, slab);
    expect(offer).not.toBeNull();
    expect(offer!.added).toHaveLength(2);
    expect(offer!.restingFaces).toHaveLength(3);
    expect(offer!.added[0].slice(1)).toBe(offer!.added[1].slice(1));
  });

  it("offers nothing when any face is already allowed, or when nothing tips", () => {
    expect(offerFor(ANY_FACES)).toBeNull();
    const shaft = getPart("PART-002");
    expect(offerFor(AS_MODELLED_FACES, shaft)).toBeNull();
  });

  it("an old Keep parts upright setting reads as as modelled and gets the offer", () => {
    const legacy = CrateSettingsSchema.parse({ ...settings({ quantity: 1 }), restingFaces: undefined, keepUpright: true });
    expect(legacy.restingFaces).toEqual(["-z"]);
    expect(layDownOffer({ part: POST, settings: legacy, plan: planShipment(POST, legacy), crateIndex: 0 })).not.toBeNull();
  });
});
