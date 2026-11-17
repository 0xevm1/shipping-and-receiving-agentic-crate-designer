import { expect, test, type Locator, type Page } from "@playwright/test";
import { crate, fileInput, island, openApp, openTab, panel, pollCrate, sampleFile, setUnits, shot } from "./helpers";

/** The design library and share links (#14): save, list and reuse per part; designs in the URL. */

const SHAFT = "PART-002-long-steel-shaft.glb";

const section = (page: Page) => panel(page).getByRole("region", { name: "Saved designs" });
const list = (page: Page) => section(page).getByRole("list", { name: "Saved designs for this part" });
// The load row shows a message as a note (status) or an error (alert); both are `.loadmsg`.
const loadMessage = (page: Page, text: string) => page.locator(".loadrow .loadmsg", { hasText: text });

/** Opens the app at `path` (a share link) and waits for the scene, like `openApp`. */
async function openAt(page: Page, path: string) {
  // From another page, so it is a fresh load and not just a hash change.
  await page.goto("about:blank");
  await page.goto(path);
  await page.waitForFunction(() => (window.__crate?.getState().frames ?? 0) > 3, undefined, { timeout: 30_000 });
}

async function setQuantity(page: Page, n: number) {
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill(String(n));
  await pollCrate(page, (s) => s.quantity).toBe(n);
  await openTab(page, "Overview");
}

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
  const field: Locator = section(page).getByLabel("Share link");
  return field.inputValue();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("a saved design is listed for its part after a reload and reused in one click", async ({ page }) => {
  test.slow(); // a reload and several recomputes
  await expect(section(page)).toContainText("None saved for this part yet.");
  await setQuantity(page, 8);
  await saveDesign(page, "Bracket × 8, two layers", "Proven on the March order");
  await setQuantity(page, 1);
  await saveDesign(page, "Single bracket");
  await expect(list(page).getByRole("listitem")).toHaveCount(2);

  // A reload keeps both (localStorage), newest first.
  await page.reload();
  await page.waitForFunction(() => (window.__crate?.getState().frames ?? 0) > 3, undefined, { timeout: 30_000 });
  await openTab(page, "Overview");
  const items = list(page).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Single bracket");
  await expect(items.nth(1)).toContainText("Bracket × 8, two layers");
  await expect(items.nth(1)).toContainText("8 parts · 938 × 658 × 823 mm · gross");
  await expect(items.nth(1)).toContainText("Proven on the March order");
  await section(page).scrollIntoViewIfNeeded();
  await shot(page, "14-saved-designs-list");
  await island(page).screenshot({ path: "e2e/screenshots/14-saved-designs-island.png" });

  // Reuse: through the design-file path, with its load message. The reload reopened the last
  // crate on screen (#71), the single bracket.
  await pollCrate(page, (s) => s.quantity).toBe(1);
  await section(page).getByRole("button", { name: "Use Bracket × 8, two layers" }).click();
  await expect(loadMessage(page, "Design loaded: 8 × Machined steel bracket.")).toBeVisible();
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await pollCrate(page, (s) => s.outside).toEqual([938, 658, 823]);

  // Another part has its own (empty) list.
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(page.getByRole("banner")).toContainText("PART-002");
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
  await section(page).getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(list(page)).toContainText("Bracket standard");
});

test("the library exports and imports as a JSON file", async ({ page }) => {
  await saveDesign(page, "Exported one");
  const [download] = await Promise.all([page.waitForEvent("download"), section(page).getByRole("button", { name: "Export library" }).click()]);
  expect(download.suggestedFilename()).toBe("crate-design-library.json");
  const text = await download.createReadStream().then(async (s) => {
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  });
  const json = JSON.parse(text);
  expect(json).toMatchObject({ kind: "crate-design-library", version: 1 });
  expect(json.entries[0]).toMatchObject({ name: "Exported one", design: { kind: "crate-design", part: { id: "PART-001" } } });

  // Clear it, then import the file back.
  await section(page).getByRole("button", { name: "Delete Exported one" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), section(page).getByRole("button", { name: "Import library" }).click()]);
  await chooser.setFiles({ name: "lib.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(section(page).getByRole("status")).toHaveText("Imported 1 design.");
  await expect(list(page)).toContainText("Exported one");
});

test("a share link opens the same crate on a fresh page", async ({ page }) => {
  test.slow();
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(page.getByRole("banner")).toContainText("PART-002");
  await setQuantity(page, 8);
  await openTab(page, "Layouts");
  await panel(page).getByRole("button", { pressed: false }).first().click();
  await openTab(page, "Overview");
  const outside = (await crate(page)).outside;
  const link = await copyShareLink(page);
  expect(link).toMatch(/\/#design=[A-Za-z0-9_-]+$/);

  // A fresh page load at the link. (A second tab or context doesn't render frames under
  // SwiftShader here, so the same tab loads it from scratch, with the library cleared.)
  await page.evaluate(() => localStorage.clear());
  const fresh = page;
  await openAt(fresh, link);
  await expect(loadMessage(fresh, "Design loaded: 8 × Long steel shaft.")).toBeVisible();
  await pollCrate(fresh, (s) => s.partId).toBe("PART-002");
  await pollCrate(fresh, (s) => s.quantity).toBe(8);
  await pollCrate(fresh, (s) => s.outside).toEqual(outside);
  // The URL is tidied once the design is open.
  expect(new URL(fresh.url()).hash).toBe("");
  await shot(fresh, "14-share-link-restored");
});

test("a damaged share link falls back to the default crate with a message", async ({ page }) => {
  await openAt(page, "/#design=eyJraW5kIjoiY3JhdGUtZGVzaWduIiwic2NoZW1hVmVyc2lvbiI6MSwic2V0dGluZ3MiOnsicXVhbnRpdHkiOjUwMDB9fQ");
  await expect(loadMessage(page, "The default crate is shown.")).toBeVisible();
  await pollCrate(page, (s) => s.partId).toBe("PART-001");
  await pollCrate(page, (s) => s.quantity).toBe(4);
  expect(new URL(page.url()).hash).toBe("");

  await openAt(page, "/#design=not*base64");
  await expect(loadMessage(page, "That share link is damaged or incomplete.")).toBeVisible();
  await shot(page, "14-share-link-invalid");
});

test("a custom part's share link names the model to load, then opens with it", async ({ page }) => {
  test.slow();
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  await page.getByLabel("Mass of one part in kilograms").fill("12.5");
  await page.getByLabel("Mass of one part in kilograms").press("Enter");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  const outside = (await crate(page)).outside;
  const link = await copyShareLink(page);
  await expect(section(page).getByRole("status")).toContainText("whoever opens it is asked for widget_v2.glb");

  const fresh = page;
  await openAt(fresh, link);
  await expect(loadMessage(fresh, "This link needs widget_v2.glb.")).toBeVisible();
  await pollCrate(fresh, (s) => s.partId).toBe("PART-001");
  await fileInput(fresh).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await expect(loadMessage(fresh, "Design loaded: 1 × Widget v2.")).toBeVisible();
  await pollCrate(fresh, (s) => s.massAssumed).toBe(false);
  await pollCrate(fresh, (s) => s.outside).toEqual(outside);
});
