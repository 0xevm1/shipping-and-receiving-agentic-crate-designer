import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { handlingChecks } from "@/domain/handling";
import { DEFAULT_STANDARDS } from "@/domain/standards";
import { renderMessage } from "./message";

describe("hand-carry check text (#113)", () => {
  const h = computeDesign(getPart("PART-001"), { ...DEFAULT_SETTINGS, quantity: 1 }, null, DEFAULT_STANDARDS).design!.handling;
  const row = handlingChecks({ ...h, grossKg: 20 }).find((c) => c.id === "hand-carry")!;

  it("reads in kilograms for metric", () => {
    expect(renderMessage(row.detail, "metric")).toBe("Gross 20 kg, at or under the 23 kg hand-carry limit, so it needs no forklift or pallet jack.");
  });

  it("reads in pounds for imperial", () => {
    expect(renderMessage(row.detail, "imperial")).toMatch(/^Gross 44\.1 lb, at or under the 50\.7 lb hand-carry limit/);
  });
});
