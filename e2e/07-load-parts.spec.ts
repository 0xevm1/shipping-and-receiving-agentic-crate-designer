import { expect, test } from "@playwright/test";
import { fileInput, island, openApp, openTab, panel, pollCrate, sampleFile, setUnits, shot, tab, triangleGlb } from "./helpers";

const SHAFT = "PART-002-long-steel-shaft.glb";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("a catalog GLB fills in its mass and material", async ({ page }) => {
  await fileInput(page).setInputFiles(sampleFile(SHAFT));

  const header = page.getByRole("banner");
  await expect(header).toContainText("PART-002 · Long steel shaft");
  await expect(header).toContainText(/4140 steel · 27 kg each · crate gross \d+ kg/);
  // Catalog parts are read-only: the same sentence, with no fields.
  await expect(header.locator("input")).toHaveCount(0);
  await expect(header).toContainText("model matches catalog");
  await expect(island(page).getByRole("heading", { name: "Long steel shaft", exact: true })).toBeVisible();
  await pollCrate(page, (s) => s.outside).toEqual([1692, 334, 411]);
  await expect(panel(page)).toContainText("1692 × 334 × 411");
  await expect(page.getByLabel("Mass of one part in kilograms")).toHaveCount(0);
  await shot(page, "07-catalog-part");
});

test("an unknown GLB uses a stand-in mass until details are entered", async ({ page }) => {
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));

  const header = page.getByRole("banner");
  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  await expect(header.getByLabel("Mass of one part in kilograms")).toHaveValue("10");
  await expect(header).toContainText("kg each stand-in");
  await expect(header).toContainText("size measured from the file");
  await expect(tab(page, /Checks/)).toHaveText("Checks1");
  await pollCrate(page, (s) => s.massAssumed).toBe(true);
  await openTab(page, /Checks/);
  await expect(panel(page)).toContainText("Part mass is a stand-in");
  await shot(page, "07-unknown-part-standin");

  // The inline fields commit on Enter (spec §8.5).
  await page.getByLabel("Part name").fill("Test widget");
  await page.getByLabel("Part name").press("Enter");
  await page.getByLabel("Part material").fill("6061-T6 aluminum");
  await page.getByLabel("Part material").press("Enter");
  await page.getByLabel("Mass of one part in kilograms").fill("12.5");
  await page.getByLabel("Mass of one part in kilograms").press("Enter");

  await expect(island(page).getByRole("heading", { name: "Test widget", exact: true })).toBeVisible();
  await expect(header).not.toContainText("stand-in");
  await expect(tab(page, /Checks/)).toHaveText("Checks");
  await expect(panel(page)).not.toContainText("Part mass is a stand-in");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("12.5 kg, 6061-T6 aluminum");
  await shot(page, "07-unknown-part-details");
});

test("a text .gltf is rejected with a message", async ({ page }) => {
  await fileInput(page).setInputFiles({
    name: "bracket.gltf",
    mimeType: "model/gltf+json",
    buffer: Buffer.from(JSON.stringify({ asset: { version: "2.0" } })),
  });
  await expect(page.getByText("Text .gltf files are not supported. Export the part as a single .glb file.")).toBeVisible();
  // The current part stays.
  await expect(page.getByRole("banner")).toContainText("PART-001");
  await shot(page, "07-gltf-rejected");
});

test("a part over 20 m is refused with a problem message", async ({ page }) => {
  // 30 000 units across, so it is read as millimetres: a 30 m part.
  await fileInput(page).setInputFiles({ name: "giant-beam.glb", mimeType: "model/gltf-binary", buffer: triangleGlb([30_000, 100, 100]) });
  const alert = panel(page).getByRole("alert");
  await expect(alert).toContainText("The part is over 20 m long");
  await expect(alert).toContainText("Its longest side is 30000 mm");
  await pollCrate(page, (s) => s.problem).toBe("part-too-large");
  await shot(page, "07-part-too-large");
});
