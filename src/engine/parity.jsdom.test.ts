// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parityCases, parityText } from "./parityCases";

describe("engine parity: browser (jsdom)", () => {
  it("runs with a DOM", () => {
    expect(typeof window).toBe("object");
    expect(typeof document.createElement).toBe("function");
  });

  it("gives the baseline results, hashes and CSVs for the sample parts", async () => {
    await expect(parityText(parityCases())).toMatchFileSnapshot("./__snapshots__/parity.json");
  });
});
