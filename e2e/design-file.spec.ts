import { expect, test, type Page } from "@playwright/test";
import {
  BRACKET,
  crate,
  cutTable,
  fileInput,
  header,
  island,
  jsonFile,
  loadMessage,
  massField,
  materialField,
  nameField,
  openApp,
  openTab,
  otherLayout,
  panel,
  pollCrate,
  readDownloadText,
  roundedMm,
  sampleFile,
  setQuantity,
  setUnits,
  SHAFT,
  shot,
  useTopRankedLayout,
  waitForRecommended,
} from "./helpers";

/** Design files: download from the Cut list tab, reopen through Load a part. */

/** Clicks "Download design (.json)" and returns the file name and parsed JSON. */
async function downloadDesign(page: Page) {
  await openTab(page, "Cut list");
  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download design (.json)" }).click()]);
  const text = await readDownloadText(download);
  return { name: download.suggestedFilename(), text, json: JSON.parse(text) };
}

/**
 * Back to PART-001 with default rules, by loading its GLB: a new part, so it opens at its
 * recommended quantity (spec §7.16). Cheaper than reopening the app, which waits for the scene
 * and the model again.
 */
async function resetToBracket(page: Page) {
  await fileInput(page).setInputFiles(sampleFile(BRACKET));
  await expect(header(page)).toContainText("PART-001");
  await waitForRecommended(page);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("the Cut list tab downloads the design as JSON with a summary", async ({ page }) => {
  const { outside, quantity } = await crate(page);
  const { name, json } = await downloadDesign(page);
  expect(name).toBe(`crate-design-PART-001-x${quantity}.json`);
  expect(json).toMatchObject({
    kind: "crate-design",
    schemaVersion: expect.any(Number),
    app: { name: "crate-designer" },
    ranking: "volume",
    part: { source: "catalog", id: "PART-001", model: BRACKET, material: "4140 steel", mass_kg: expect.any(Number) },
    settings: { quantity, restingFaces: ["-z"], maxLayers: expect.any(Number), panelThickness: "auto" },
    summary: { quantity, outsideMm: roundedMm(outside!) },
  });
  expect(typeof json.layoutKey).toBe("string");
  expect(json.summary.grossKg).toBeGreaterThan(quantity * json.part.mass_kg);
  await expect(panel(page).getByRole("status")).toHaveText("Design downloaded.");
  await shot(page, "design-file-download");
});

test("a catalog design reopens with its rules, layout and cut list", async ({ page }) => {
  // Two part loads and two downloads: a long flow, so it gets the 3× budget.
  test.slow();
  // A non-default design: the shaft, 8 of them, and a layout that isn't the recommended one.
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(header(page)).toContainText("PART-002");
  await setQuantity(page, 8);
  await openTab(page, "Layouts");
  const before = (await crate(page)).outside;
  await otherLayout(page).first().click();
  // The picked layout's design lands from the engine's worker a moment after the click.
  await pollCrate(page, (s) => s.outside).not.toEqual(before);
  const picked = (await crate(page)).outside;
  await openTab(page, "Cut list");
  const cutList = await cutTable(page).innerText();
  const saved = await downloadDesign(page);
  expect(saved.json.part).toMatchObject({ source: "catalog", id: "PART-002" });
  expect(saved.json.summary.outsideMm).toEqual(roundedMm(picked!));

  // Switch to another part (which resets the rules and layout), then open the design.
  await resetToBracket(page);
  await fileInput(page).setInputFiles(jsonFile(saved.text));
  await expect(loadMessage(page, "Design loaded: 8 × Long steel shaft.")).toBeVisible();
  await expect(header(page)).toContainText("PART-002 · Long steel shaft");
  await expect(header(page)).toContainText(/4140 steel · [\d.]+ kg each/);
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await pollCrate(page, (s) => s.outside).toEqual(picked);
  await openTab(page, "Cut list");
  expect(await cutTable(page).innerText()).toBe(cutList);
  await shot(page, "design-file-catalog-restored");

  // Saving it again gives the same design.
  const again = await downloadDesign(page);
  expect({ ...again.json, savedAt: "" }).toEqual({ ...saved.json, savedAt: "" });
});

test("a design whose layout no longer exists falls back to the recommended one", async ({ page }) => {
  // The app opens at the sweep's layout; the fallback is the Layouts ranking's recommended one.
  await useTopRankedLayout(page);
  const { outside } = await crate(page);
  const saved = await downloadDesign(page);
  const stale = { ...saved.json, layoutKey: "u:1x1x1:999" };
  await fileInput(page).setInputFiles(jsonFile(JSON.stringify(stale)));
  await expect(loadMessage(page, "no longer fits, so the recommended one is shown")).toBeVisible();
  await pollCrate(page, (s) => s.outside).toEqual(outside);
});

test("a custom design needs its model: named when missing, restored when added", async ({ page }) => {
  test.slow(); // three part loads and a download
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  // It opens at its recommended quantity, which the design keeps.
  const { quantity } = await waitForRecommended(page);
  // The inline fields commit on Enter.
  for (const [field, value] of [
    [nameField(page), "Test widget"],
    [materialField(page), "6061-T6 aluminum"],
    [massField(page), "12.5"],
  ] as const) {
    await field.fill(value);
    await field.press("Enter");
  }
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  const outside = (await crate(page)).outside;
  const saved = await downloadDesign(page);
  expect(saved.json.part).toMatchObject({ source: "custom", id: "widget_v2", model: "widget_v2.glb", name: "Test widget", mass_kg: 12.5 });

  // Without the model: nothing changes and the message names the file.
  await resetToBracket(page);
  await fileInput(page).setInputFiles(jsonFile(saved.text));
  await expect(loadMessage(page, "This design needs widget_v2.glb. Choose its .glb together with the design file.")).toBeVisible();
  await expect(header(page)).toContainText("PART-001");
  await shot(page, "design-file-custom-needs-model");

  // With the model picked at the same time: restored, entered details and all.
  await fileInput(page).setInputFiles([jsonFile(saved.text), sampleFile(SHAFT, "widget_v2.glb")]);
  await expect(loadMessage(page, `Design loaded: ${quantity} × Test widget.`)).toBeVisible();
  await pollCrate(page, (s) => s.quantity).toBe(quantity);
  await expect(island(page).getByRole("heading", { name: "Test widget", exact: true })).toBeVisible();
  await expect(header(page)).not.toContainText("stand-in");
  await pollCrate(page, (s) => s.partId).toBe("widget_v2");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await pollCrate(page, (s) => s.outside).toEqual(outside);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("12.5 kg, 6061-T6 aluminum");
  await shot(page, "design-file-custom-restored");
});

test("a design from a newer app is refused with a message", async ({ page }) => {
  const saved = await downloadDesign(page);
  await fileInput(page).setInputFiles(jsonFile(JSON.stringify({ ...saved.json, schemaVersion: saved.json.schemaVersion + 1 })));
  await expect(loadMessage(page, "saved by a newer version of the app")).toBeVisible();
  await expect(header(page)).toContainText("PART-001");
});
