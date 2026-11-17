// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { artifactCsvText } from "./artifactCases";

describe("artifacts: browser (jsdom)", () => {
  it("runs with a DOM", () => expect(typeof document.createElement).toBe("function"));

  it("writes the same cut-list CSV bytes as Node", async () => {
    await expect(await artifactCsvText()).toMatchFileSnapshot("./__snapshots__/artifacts-csv.txt");
  });
});
