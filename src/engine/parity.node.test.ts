// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parityCases, parityText } from "./parityCases";

describe("engine parity: Node", () => {
  it("runs without a DOM", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("gives the baseline results, hashes and CSVs for the sample parts", async () => {
    await expect(parityText(parityCases())).toMatchFileSnapshot("./__snapshots__/parity.json");
  });
});
