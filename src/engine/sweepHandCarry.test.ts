import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { DEFAULT_SWEEP_RULES, runSweep } from "./sweep";

/** The device cautions are not hard checks (`hardFailure`), so the hand-carry rule can't move the sweep (#113). */
describe("the sweep with a light part", () => {
  const pin = { id: "pin", name: "pin", mass_kg: 0.05, dimensions_mm: [40, 30, 20] as [number, number, number], material: "steel" as const };
  const sweep = (handCarryMaxKg: number) =>
    runSweep({ part: pin, rules: DEFAULT_SWEEP_RULES, standards: { ...DEFAULT_STANDARDS, handling: { ...DEFAULT_STANDARDS.handling, handCarryMaxKg } } }).sweep;

  it("passes the one-part crate, which the old device cautions never failed", () => {
    const q1 = sweep(23).curve.find((p) => p.quantity === 1)!;
    expect(q1.ok).toBe(true);
    expect(q1.binding).toBeNull();
  });

  it("recommends and ranks the same with the rule on or off", () => {
    const on = sweep(23);
    const off = sweep(0);
    expect(on.recommendation?.quantity).toBe(off.recommendation?.quantity);
    expect(on.curve.map((p) => [p.quantity, p.ok, p.binding])).toEqual(off.curve.map((p) => [p.quantity, p.ok, p.binding]));
    expect(on.shortlist.map((p) => p.quantity)).toEqual(off.shortlist.map((p) => p.quantity));
  });
});
