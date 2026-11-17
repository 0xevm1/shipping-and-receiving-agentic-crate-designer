import { describe, expect, it } from "vitest";
import { CreatePartFieldsSchema } from "./parts";

const parse = (fields: Record<string, string | null>) => CreatePartFieldsSchema.safeParse(fields);
const firstError = (fields: Record<string, string | null>) => {
  const r = parse(fields);
  return r.success ? undefined : { path: r.error.issues[0]!.path.join("."), message: r.error.issues[0]!.message };
};

describe("CreatePartFieldsSchema", () => {
  it("reads kg, material, density and name", () => {
    expect(parse({ mass: " 12.5 kg ", material: "4140 steel", density: "7850", name: "Bracket" }).data).toEqual({
      mass: 12.5,
      material: "4140 steel",
      density: 7850,
      name: "Bracket",
    });
    expect(parse({ mass: "3,25" }).data).toEqual({ mass: 3.25, material: undefined, density: undefined, name: undefined });
  });

  it("refuses a missing or bad mass with the part header's words", () => {
    expect(firstError({})).toEqual({ path: "mass", message: "Enter the mass of one part in kg." });
    expect(firstError({ mass: null })).toEqual({ path: "mass", message: "Enter the mass of one part in kg." });
    expect(firstError({ mass: "heavy" })).toEqual({ path: "mass", message: "Enter a number of kg, like 12.5." });
    expect(firstError({ mass: "0" })).toEqual({ path: "mass", message: "Mass must be more than 0 kg." });
    expect(firstError({ mass: "30 lb" })).toEqual({ path: "mass", message: "Enter a number of kg, like 12.5." });
  });

  it("refuses a bad density and over-long text", () => {
    expect(firstError({ mass: "1", density: "dense" })?.path).toBe("density");
    expect(firstError({ mass: "1", density: "-3" })?.message).toBe("Density must be more than 0 kg/m³.");
    expect(firstError({ mass: "1", name: "x".repeat(201) })?.path).toBe("name");
  });
});
