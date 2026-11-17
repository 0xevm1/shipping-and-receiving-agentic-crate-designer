import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parts } from "@/domain/catalog";
import { DEFAULT_SETTINGS } from "@/domain/design";
import { restingFace } from "@/domain/orientations";
import { layDownOffer } from "@/domain/restingFaces";
import { planShipment } from "@/domain/shipment";
import { loadPartFiles } from "./loadPart";

/** The tall-part scenario of the demo sheet (#109), through the real file: tip-over, then lie it down. */
describe("the tall part (fixtures/scenarios/tall-part.glb)", () => {
  const file = (name: string) => new File([readFileSync(`fixtures/scenarios/${name}`)], name);
  const load = async () => {
    const out = await loadPartFiles([file("parts-lenient.json"), file("tall-part.glb")], parts);
    if (!out.part) throw new Error("the fixture did not load");
    return out.part;
  };
  const cautions = (plan: ReturnType<typeof planShipment>) => plan.crates[0].result.design!.checks.filter((c) => c.level === "caution").map((c) => c.id);

  it("stands up as modelled with both tipping cautions, and the check offers the lying-down layout", async () => {
    const part = await load();
    expect(part.dimensions_mm).toEqual([150, 150, 1200]);
    const settings = { ...DEFAULT_SETTINGS, quantity: 1 };
    const plan = planShipment(part, settings);
    expect(cautions(plan)).toEqual(expect.arrayContaining(["stable", "cog-tip"]));
    const offer = layDownOffer({ part, settings, plan, crateIndex: 0 });
    expect(offer?.lyingDown).toBe(true);
  });

  it("taking the offer clears both cautions and lays the part on a side", async () => {
    const part = await load();
    const settings = { ...DEFAULT_SETTINGS, quantity: 1 };
    const offer = layDownOffer({ part, settings, plan: planShipment(part, settings), crateIndex: 0 })!;
    const taken = planShipment(part, { ...settings, restingFaces: offer.restingFaces });
    expect(cautions(taken)).not.toContain("stable");
    expect(cautions(taken)).not.toContain("cog-tip");
    expect(restingFace(taken.crates[0].result.design!.layout.orientation)).not.toBe("-z");
    // The offer goes away once the stable layout is the one on screen.
    expect(layDownOffer({ part, settings: { ...settings, restingFaces: offer.restingFaces }, plan: taken, crateIndex: 0 })).toBeNull();
  });
});
