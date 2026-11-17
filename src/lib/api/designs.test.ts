import { describe, expect, it } from "vitest";
import { DesignsFieldsSchema, MAX_TOTAL_QUANTITY } from "./designs";

const parse = (fields: Record<string, string>) => DesignsFieldsSchema.safeParse({ mass: "2", ...fields });

describe("POST /api/v1/designs fields", () => {
  it("takes the part fields of /parts plus an optional total and freight rates", () => {
    const r = parse({ total: " 40 ", freightRates: '{"usdPerCwtByClass":{"70":41.5},"minimumUsd":95}' });
    expect(r.success && r.data).toMatchObject({ mass: 2, total: 40, freightRates: { usdPerCwtByClass: { "70": 41.5 }, minimumUsd: 95 } });
    const bare = parse({});
    expect(bare.success && bare.data.total).toBeUndefined();
    expect(bare.success && bare.data.freightRates).toBeUndefined();
  });

  it.each([
    [{ total: "0" }, "total"],
    [{ total: "2.5" }, "total"],
    [{ total: String(MAX_TOTAL_QUANTITY + 1) }, "total"],
    [{ freightRates: "nope" }, "freightRates"],
    [{ freightRates: '{"usdPerCwtByClass":{}}' }, "freightRates"],
    [{ mass: "" }, "mass"],
  ])("refuses %j", (fields, path) => {
    const r = parse(fields);
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0]!.path[0]).toBe(path);
  });
});
