import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { crate, fileInput, island, openApp, openTab, panel, pollCrate, sampleFile, shot } from "./helpers";

/** Design files (#28): download from the Cut list tab, reopen through Load a part. */

const SHAFT = "PART-002-long-steel-shaft.glb";

/** Clicks "Download design (.json)" and returns the file name and parsed JSON. */
async function downloadDesign(page: Page) {
  await openTab(page, "Cut list");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel(page).getByRole("button", { name: "Download design (.json)" }).click(),
  ]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, json: JSON.parse(text) };
}

const designFile = (text: string, name = "crate-design.json") => ({ name, mimeType: "application/json", buffer: Buffer.from(text) });
/** The load row message under the 3D view (a substring is enough). */
const loadMessage = (page: Page, text: string) => page.locator(".loadrow").getByRole("status").filter({ hasText: text });

/**
 * Back to PART-001 at quantity 1 with default rules, by loading its GLB. Cheaper than reopening
 * the app, which waits for the scene and the model again.
 */
async function resetToBracket(page: Page) {
  await fileInput(page).setInputFiles(sampleFile("PART-001-machined-steel-bracket.glb"));
  await expect(page.getByRole("banner")).toContainText("PART-001");
  await pollCrate(page, (s) => s.quantity).toBe(1);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("the Cut list tab downloads the design as JSON with a summary", async ({ page }) => {
  const { name, json } = await downloadDesign(page);
  expect(name).toBe("crate-design-PART-001-x4.json");
  expect(json).toMatchObject({
    kind: "crate-design",
    schemaVersion: 1,
    app: { name: "crate-designer" },
    part: { source: "catalog", id: "PART-001", model: "PART-001-machined-steel-bracket.glb", material: "4140 steel", mass_kg: 21.5 },
    settings: { quantity: 4, keepUpright: true, maxLayers: 2, partGapMm: 50, wallClearanceMm: 50, panelThickness: "auto" },
    summary: { quantity: 4, outsideMm: [932, 652, 497] },
  });
  expect(typeof json.layoutKey).toBe("string");
  expect(json.summary.grossKg).toBeGreaterThan(4 * 21.5);
  await expect(panel(page).getByRole("status")).toHaveText("Design downloaded.");
  await shot(page, "09-design-download");
});

test("a catalog design reopens with its rules, layout and cut list", async ({ page }) => {
  // A non-default design: the shaft, 8 of them, and a layout that isn't the recommended one.
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(page.getByRole("banner")).toContainText("PART-002");
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await openTab(page, "Layouts");
  await panel(page).getByRole("button", { pressed: false }).first().click();
  const picked = (await crate(page)).outside;
  await openTab(page, "Cut list");
  const cutList = await panel(page).locator("table.cut").innerText();
  const saved = await downloadDesign(page);
  expect(saved.json.part).toMatchObject({ source: "catalog", id: "PART-002" });
  expect(saved.json.summary.outsideMm).toEqual(picked!.map(Math.round));

  // Switch to another part (which resets the rules and layout), then open the design.
  await resetToBracket(page);
  await fileInput(page).setInputFiles(designFile(saved.text));
  await expect(loadMessage(page, "Design loaded: 8 × Long steel shaft.")).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("PART-002 · 4140 steel · 27 kg each");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await pollCrate(page, (s) => s.outside).toEqual(picked);
  await openTab(page, "Cut list");
  expect(await panel(page).locator("table.cut").innerText()).toBe(cutList);
  await shot(page, "09-design-catalog-restored");

  // Saving it again gives the same design.
  const again = await downloadDesign(page);
  expect({ ...again.json, savedAt: "" }).toEqual({ ...saved.json, savedAt: "" });
});

test("a design whose layout no longer exists falls back to the recommended one", async ({ page }) => {
  const saved = await downloadDesign(page);
  const stale = { ...saved.json, layoutKey: "u:1x1x1:999" };
  await fileInput(page).setInputFiles(designFile(JSON.stringify(stale)));
  await expect(loadMessage(page, "no longer fits, so the recommended layout is shown")).toBeVisible();
  await pollCrate(page, (s) => s.outside).toEqual([932, 652, 497]);
});

test("a custom design needs its model: named when missing, restored when added", async ({ page }) => {
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  await page.getByLabel("Part name").fill("Test widget");
  await page.getByLabel("Part material").fill("6061-T6 aluminum");
  await page.getByLabel("Mass of one part in kilograms").fill("12.5");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  const outside = (await crate(page)).outside;
  const saved = await downloadDesign(page);
  expect(saved.json.part).toMatchObject({ source: "custom", id: "widget_v2", model: "widget_v2.glb", name: "Test widget", mass_kg: 12.5 });

  // Without the model: nothing changes and the message names the file.
  await resetToBracket(page);
  await fileInput(page).setInputFiles(designFile(saved.text));
  await expect(
    loadMessage(page, "This design uses a custom model. Add widget_v2.glb together with the design file: pick or drop both at once."),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("PART-001");
  await shot(page, "09-design-custom-needs-model");

  // With the model picked at the same time: restored, entered details and all.
  await fileInput(page).setInputFiles([designFile(saved.text), sampleFile(SHAFT, "widget_v2.glb")]);
  await expect(loadMessage(page, "Design loaded: 1 × Test widget.")).toBeVisible();
  await expect(island(page).getByRole("heading", { name: "Test widget", exact: true })).toBeVisible();
  await expect(page.getByRole("banner")).not.toContainText("stand-in");
  await pollCrate(page, (s) => s.partId).toBe("widget_v2");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await pollCrate(page, (s) => s.outside).toEqual(outside);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("12.5 kg, 6061-T6 aluminum");
  await shot(page, "09-design-custom-restored");
});

test("a design from a newer app is refused with a message", async ({ page }) => {
  const saved = await downloadDesign(page);
  await fileInput(page).setInputFiles(designFile(JSON.stringify({ ...saved.json, schemaVersion: 2 })));
  await expect(loadMessage(page, "saved by a newer version of the app")).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("PART-001");
});
