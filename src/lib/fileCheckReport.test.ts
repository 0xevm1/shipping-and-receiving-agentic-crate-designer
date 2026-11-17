import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFiles, type FileInput } from "./fileCheck";
import { countsText, groupByFile, outcomeText, reportFor, reportText, verdict } from "./fileCheckReport";

const glb = (name: string): FileInput => {
  const b = readFileSync(`fixtures/scenarios/${name}`);
  return { name, content: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
};
const json = (name: string): FileInput => ({ name, content: readFileSync(`fixtures/scenarios/${name}`, "utf8") });
const reportOf = (files: FileInput[]) => {
  const check = checkFiles(files);
  return { check, report: reportFor(check, check.opened !== null)! };
};

describe("the one-line verdict", () => {
  it.each([
    ["a clean load says nothing", [json("parts.json"), glb("heavy-1500kg.glb")], ""],
    [
      "a skipped entry names the part and the field",
      [json("parts-missing-field.json"), glb("heavy-1500kg.glb")],
      "parts-missing-field.json: 1 entry skipped (SCN-900: mass_kg).",
    ],
    [
      "ignored fields and what else was found",
      [json("parts-ignored-fields.json"), glb("tall-part.glb")],
      "parts-ignored-fields.json: 7 fields ignored, newer schema_version, unknown model_units.",
    ],
    [
      "implausible values",
      [json("parts-implausible.json"), glb("lopsided.glb")],
      "parts-implausible.json: implausible mass, implausible density, implausible size.",
    ],
    [
      "a file that can't be opened says why",
      [glb("draco.glb")],
      "draco.glb can't be opened. That .glb uses Draco compression, which the viewer can't read. Export it again without Draco compression.",
    ],
    [
      "a parts.json that isn't JSON says where",
      [json("parts-trailing-comma.json")],
      "parts-trailing-comma.json can't be read. This isn't valid JSON: unexpected \"]\" at line 4, column 3. Fix that and load it again.",
    ],
    [
      "two models say which opened",
      [glb("heavy-1500kg.glb"), glb("tiny-light.glb")],
      "Opened heavy-1500kg.glb. The app designs one part at a time, so tiny-light.glb was not used.",
    ],
    [
      "three models",
      [glb("heavy-1500kg.glb"), glb("tiny-light.glb"), glb("tall-part.glb")],
      "Opened heavy-1500kg.glb. The app designs one part at a time, so tiny-light.glb, tall-part.glb were not used.",
    ],
    [
      "a bad file next to a good one",
      [glb("draco.glb"), glb("tall-part.glb")],
      "draco.glb can't be opened. That .glb uses Draco compression, which the viewer can't read. Export it again without Draco compression.",
    ],
  ])("%s", (_, files, expected) => {
    expect(verdict(checkFiles(files))).toBe(expected);
  });

  it("falls back to counts when several files have something to say", () => {
    const line = verdict(checkFiles([json("parts-implausible.json"), glb("lopsided.glb"), glb("tiny-light.glb"), glb("draco.glb")]));
    expect(line.length).toBeLessThanOrEqual(170);
    expect(line).toMatch(/^Opened lopsided\.glb\. \d+ files checked: 1 error, \d+ warnings, \d+ notes?\. See Details\.$/);
  });

  it("never carries a length, so it needs no units toggle: a size mismatch is a few words", () => {
    expect(verdict(checkFiles([json("parts-size-mismatch.json"), glb("size-mismatch.glb")]))).toBe("size-mismatch.glb: model size differs from parts.json.");
  });
});

describe("the report", () => {
  it("counts by severity, leaving out the empty ones", () => {
    const { check } = reportOf([json("parts-bad-entries.json"), glb("heavy-1500kg.glb")]);
    expect(countsText(check.findings)).toBe("6 errors");
    expect(countsText(reportOf([json("parts-ignored-fields.json"), glb("tall-part.glb")]).check.findings)).toBe("6 warnings, 3 notes");
    expect(countsText(reportOf([glb("heavy-1500kg.glb"), glb("tiny-light.glb")]).check.findings)).toBe("1 note");
  });

  it("groups findings by file in the order the files were picked", () => {
    const { check } = reportOf([glb("damaged.glb"), json("parts-bad-entries.json"), glb("draco.glb")]);
    expect(groupByFile(check.findings).map((g) => g.file)).toEqual(["damaged.glb", "parts-bad-entries.json", "draco.glb"]);
  });

  it("is null when the check found nothing", () => {
    const check = checkFiles([json("parts.json"), glb("heavy-1500kg.glb")]);
    expect(reportFor(check, true)).toBeNull();
  });

  it("says what the load did", () => {
    expect(outcomeText({ opened: "a.glb", loaded: true })).toBe("Opened a.glb.");
    expect(outcomeText({ opened: null, loaded: true })).toBe("Design loaded.");
    expect(outcomeText({ opened: null, loaded: false })).toBe("Nothing was opened, so the crate on screen is unchanged.");
  });

  it("copies as plain text, with quantities in the selected units", () => {
    const { report } = reportOf([json("parts-size-mismatch.json"), glb("size-mismatch.glb")]);
    expect(reportText(report, "metric")).toBe(
      [
        "File check: 1 warning",
        "Opened size-mismatch.glb.",
        "",
        "size-mismatch.glb",
        "  WARNING SCN-902: The model measures 360 mm × 220 mm × 300 mm but SCN-902 says 360 mm × 220 mm × 258 mm. Check dimensions_mm and model_units, or the file's units under the part's size at the top left.",
        "",
      ].join("\n"),
    );
    expect(reportText(report, "imperial")).toContain("The model measures 14.2 in × 8.7 in × 11.8 in but SCN-902 says 14.2 in × 8.7 in × 10.2 in.");
  });

  it("says nothing was opened when only errors were found", () => {
    const { report } = reportOf([glb("draco.glb"), json("parts-trailing-comma.json")]);
    expect(reportText(report, "metric")).toMatch(
      /^File check: 2 errors\nNothing was opened, so the crate on screen is unchanged\.\n\ndraco\.glb\n {2}ERROR: That \.glb uses Draco/,
    );
  });
});
