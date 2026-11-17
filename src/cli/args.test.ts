import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args";

const ok = (argv: string[], env = {}, read?: (p: string) => string) => {
  const r = parseCliArgs(argv, env, read);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.options;
};
const error = (argv: string[]) => {
  const r = parseCliArgs(argv);
  if (r.ok) throw new Error("expected an error");
  return r;
};

describe("crate CLI arguments", () => {
  it("reads the documented example", () => {
    const o = ok(["--", "part.glb", "--mass", "21.5", "--total", "40", "--out", "./out"]);
    expect(o).toMatchObject({ file: "part.glb", massKg: 21.5, total: 40, out: "./out", offline: false, api: "http://localhost:3000", key: null });
    expect(o.fields).toEqual({ mass: "21.5", total: "40" });
  });

  it("takes the API and key from flags first, then the environment", () => {
    expect(ok(["p.glb", "--mass", "2"], { CRATE_API_URL: "http://api:8080/", CRATE_API_KEY: "k" })).toMatchObject({ api: "http://api:8080", key: "k" });
    expect(ok(["p.glb", "--mass", "2", "--api", "http://x", "--key", "y"], { CRATE_API_URL: "http://api", CRATE_API_KEY: "k" })).toMatchObject({
      api: "http://x",
      key: "y",
    });
  });

  it("reads --offline, the part fields and freight rates (inline or @file)", () => {
    const rates = '{"usdPerCwtByClass":{"70":41.5}}';
    const o = ok(["p.glb", "--mass", "12 kg", "--offline", "--material", "steel", "--density", "7850", "--name", "Bracket", "--freight-rates", rates]);
    expect(o).toMatchObject({ offline: true, massKg: 12, material: "steel", density: 7850, name: "Bracket" });
    expect(o.freightRates).toEqual({ usdPerCwtByClass: { "70": 41.5 }, minimumUsd: 0 });
    const fromFile = ok(["p.glb", "--mass", "1", "--freight-rates", "@rates.json"], {}, (p) => (p === "rates.json" ? rates : ""));
    expect(fromFile.fields.freightRates).toBe(rates);
  });

  it("explains what is wrong, in the API's words", () => {
    expect(error(["--mass", "2"]).error).toBe("Give the part's .glb file.");
    expect(error(["a.glb", "b.glb", "--mass", "2"]).error).toBe("Give one .glb file.");
    expect(error(["a.glb"]).error).toBe("Give the part's mass with --mass <kg>.");
    expect(error(["a.glb", "--mass", "30 lb"]).error).toMatch(/^--mass: /);
    expect(error(["a.glb", "--mass", "2", "--total", "0"]).error).toMatch(/^--total: Total must be a whole number/);
    expect(error(["a.glb", "--mass", "2", "--freight-rates", "{"]).error).toMatch(/^--freight-rates: Freight rates must be JSON/);
    expect(error(["a.glb", "--mass", "2", "--bogus"]).error).toMatch(/bogus/);
  });

  it("asks for help with -h", () => {
    expect(parseCliArgs(["-h"])).toEqual({ ok: false, help: true, error: null });
  });
});
