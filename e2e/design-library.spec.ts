import { expect, test, type Page } from "@playwright/test";
import {
  crate,
  fileInput,
  header,
  island,
  jsonFile,
  loadMessage,
  massField,
  mmText,
  openApp,
  openFresh,
  openTab,
  otherLayout,
  panel,
  pollCrate,
  readDownloadText,
  reloadApp,
  sampleFile,
  setQuantity,
  setUnits,
  SHAFT,
  shot,
} from "./helpers";

/** The design library and share links: save, list and reuse per part; designs in the URL. */

const section = (page: Page) => panel(page).getByRole("region", { name: "Saved designs" });
const list = (page: Page) => section(page).getByRole("list", { name: "Saved designs for this part" });

async function saveDesign(page: Page, name: string, notes = "") {
  await section(page).getByRole("button", { name: "Save design" }).click();
  const form = section(page).getByRole("form", { name: "Save this design" });
  await form.getByLabel("Design name").fill(name);
  if (notes) await form.getByLabel("Notes (optional)").fill(notes);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText(`Saved “${name}”.`);
}

/** Clicks "Copy share link" and returns the link shown under it. */
async function copyShareLink(page: Page): Promise<string> {
  await section(page).getByRole("button", { name: "Copy share link" }).click();
  await expect(section(page).getByRole("status")).toHaveText(/Share link copied|Copy is blocked here/);
  return section(page).getByLabel("Share link").inputValue();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("a saved design is listed for its part after a reload and reused in one click", async ({ page }) => {
  test.slow(); // a reload and several recomputes
  await expect(section(page)).toContainText("None saved for this part yet.");
  await setQuantity(page, 8);
  const outside8 = (await crate(page)).outside!;
  await openTab(page, "Overview");
  await saveDesign(page, "Bracket × 8, two layers", "Proven on the March order");
  await setQuantity(page, 1);
  await openTab(page, "Overview");
  await saveDesign(page, "Single bracket");
  await expect(list(page).getByRole("listitem")).toHaveCount(2);

  // A reload keeps both (localStorage), newest first.
  await reloadApp(page);
  await openTab(page, "Overview");
  const items = list(page).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Single bracket");
  await expect(items.nth(1)).toContainText("Bracket × 8, two layers");
  await expect(items.nth(1)).toContainText(`8 parts · ${mmText(outside8)} mm · gross`);
  await expect(items.nth(1)).toContainText("Proven on the March order");
  await section(page).scrollIntoViewIfNeeded();
  await shot(page, "design-library-list");
  await shot(island(page), "design-library-island");

  // Reuse: through the design-file path, with its load message. The reload reopened the last
  // crate on screen, the single bracket.
  await pollCrate(page, (s) => s.quantity).toBe(1);
  await section(page).getByRole("button", { name: "Use Bracket × 8, two layers" }).click();
  await expect(loadMessage(page, "Design loaded: 8 × Machined steel bracket.")).toBeVisible();
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await pollCrate(page, (s) => s.outside).toEqual(outside8);

  // Another part has its own (empty) list.
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(header(page)).toContainText("PART-002");
  await expect(section(page)).toContainText("None saved for this part yet.");
});

test("saved designs can be renamed, and deleted with an undo", async ({ page }) => {
  await saveDesign(page, "Draft");
  await section(page).getByRole("button", { name: "Rename Draft" }).click();
  const input = section(page).getByLabel("New name for Draft");
  await input.fill("Bracket standard");
  await input.press("Enter");
  await expect(list(page)).toContainText("Bracket standard");

  await section(page).getByRole("button", { name: "Delete Bracket standard" }).click();
  await expect(section(page).getByRole("status")).toContainText("Deleted “Bracket standard”.");
  await expect(list(page)).toBeHidden();
  await section(page).getByRole("button", { name: "Undo" }).click(); // outside the live region
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(list(page)).toContainText("Bracket standard");
});

test("Save, Rename and Delete leave focus on a sensible control", async ({ page }) => {
  await section(page).getByRole("button", { name: "Save design" }).click();
  const form = section(page).getByRole("form", { name: "Save this design" });
  await expect(form.getByLabel("Design name")).toBeFocused();
  await form.getByLabel("Design name").fill("Focus check");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText("Saved “Focus check”.");
  await expect(section(page).getByRole("button", { name: "Save design" })).toBeFocused();

  await section(page).getByRole("button", { name: "Rename Focus check" }).click();
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  await expect(section(page).getByRole("button", { name: /^Rename / })).toBeFocused();

  await section(page)
    .getByRole("button", { name: /^Delete / })
    .click();
  await expect(section(page).getByRole("heading", { name: "Saved designs" })).toBeFocused();
  // The status announces the deletion; the Undo button sits outside the live region.
  await expect(section(page).getByRole("status")).toContainText("Deleted");
  await expect(section(page).getByRole("status").getByRole("button")).toHaveCount(0);
  await section(page).getByRole("button", { name: "Undo" }).click();
  await expect(section(page).getByRole("status")).toContainText("Restored");
  await expect(section(page).getByRole("heading", { name: "Saved designs" })).toBeFocused();
});

test("the library exports and imports as a JSON file", async ({ page }) => {
  await saveDesign(page, "Exported one");
  const [download] = await Promise.all([page.waitForEvent("download"), section(page).getByRole("button", { name: "Export library" }).click()]);
  expect(download.suggestedFilename()).toBe("crate-design-library.json");
  const text = await readDownloadText(download);
  const json = JSON.parse(text);
  expect(json).toMatchObject({ kind: "crate-design-library", version: 1 });
  expect(json.entries[0]).toMatchObject({ name: "Exported one", design: { kind: "crate-design", part: { id: "PART-001" } } });

  // Clear it, then import the file back.
  await section(page).getByRole("button", { name: "Delete Exported one" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), section(page).getByRole("button", { name: "Import library" }).click()]);
  await chooser.setFiles(jsonFile(text, "lib.json"));
  await expect(section(page).getByRole("status")).toHaveText("Imported 1 design.");
  await expect(list(page)).toContainText("Exported one");
});

test("a share link opens the same crate on a fresh page", async ({ page }) => {
  test.slow();
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(header(page)).toContainText("PART-002");
  await setQuantity(page, 8);
  const defaultOutside = (await crate(page)).outside;
  await openTab(page, "Layouts");
  // A layout card other than the one on screen.
  const card = otherLayout(page).first();
  const cardSize = /\d+ × \d+ × \d+/.exec(await card.innerText())![0];
  await card.click();
  await openTab(page, "Overview");
  const outside = (await crate(page)).outside;
  // The pick really changed the crate, to the size the card showed.
  expect(outside).not.toEqual(defaultOutside);
  expect(mmText(outside!)).toBe(cardSize);
  const link = await copyShareLink(page);
  expect(link).toMatch(/\/#design=[A-Za-z0-9_-]+$/);

  // A fresh page load at the link. (A second tab or context doesn't render frames under
  // SwiftShader here, so the same tab loads it from scratch, with the library cleared.)
  await page.evaluate(() => localStorage.clear());
  await openFresh(page, link);
  await expect(loadMessage(page, "Design loaded: 8 × Long steel shaft.")).toBeVisible();
  await pollCrate(page, (s) => s.partId).toBe("PART-002");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await pollCrate(page, (s) => s.outside).toEqual(outside);
  // The URL is tidied once the design is open.
  expect(new URL(page.url()).hash).toBe("");
  await shot(page, "design-library-share-link-restored");
});

test("a damaged share link falls back to the default crate with a message", async ({ page }) => {
  await openFresh(page, "/#design=eyJraW5kIjoiY3JhdGUtZGVzaWduIiwic2NoZW1hVmVyc2lvbiI6MSwic2V0dGluZ3MiOnsicXVhbnRpdHkiOjUwMDB9fQ");
  await expect(loadMessage(page, "The default crate is shown.")).toBeVisible();
  await pollCrate(page, (s) => s.partId).toBe("PART-001");
  await pollCrate(page, (s) => s.quantity).toBe(4);
  expect(new URL(page.url()).hash).toBe("");

  await openFresh(page, "/#design=not*base64");
  await expect(loadMessage(page, "That share link is damaged or incomplete.")).toBeVisible();
  await shot(page, "design-library-share-link-invalid");
});

test("a custom part's share link names the model to load, then opens with it", async ({ page }) => {
  test.slow();
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  await massField(page).fill("12.5");
  await massField(page).press("Enter");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  const outside = (await crate(page)).outside;
  const link = await copyShareLink(page);
  await expect(section(page).getByRole("status")).toContainText("whoever opens it is asked for widget_v2.glb");

  await openFresh(page, link);
  await expect(loadMessage(page, "This link needs widget_v2.glb.")).toBeVisible();
  await pollCrate(page, (s) => s.partId).toBe("PART-001");
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await expect(loadMessage(page, "Design loaded: 1 × Widget v2.")).toBeVisible();
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await pollCrate(page, (s) => s.outside).toEqual(outside);
});
