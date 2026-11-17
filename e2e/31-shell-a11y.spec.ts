import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp, sampleFile } from "./helpers";

const viewButton = (page: Page) => page.getByRole("button", { name: "View", exact: true });
const pop = (page: Page) => page.locator("#view-pop");

test.describe("View popover", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await viewButton(page).click();
    await expect(pop(page)).toBeVisible();
  });

  test("aria-controls names the popover only while it exists", async ({ page }) => {
    await expect(viewButton(page)).toHaveAttribute("aria-controls", "view-pop");
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);
    await expect(viewButton(page)).not.toHaveAttribute("aria-controls", /.+/);
  });

  test("Escape closes it and returns focus to the View button", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Lid" }).focus();
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);
    await expect(viewButton(page)).toBeFocused();
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("closes when keyboard focus leaves it", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Size labels" }).focus();
    // Past the last control the focus goes to the Hide panels button, outside the popover.
    await page.getByRole("slider", { name: "Pull apart" }).focus();
    await page.keyboard.press("Tab");
    await expect(pop(page)).toHaveCount(0);
  });

  test("closes on a press outside", async ({ page }) => {
    await page.getByRole("region", { name: "3D view of the crate" }).click({ position: { x: 200, y: 400 } });
    await expect(pop(page)).toHaveCount(0);
  });
});

test("dragging text over the page doesn't raise the drop veil or swallow the drop", async ({ page }) => {
  await openApp(page);
  const veil = page.locator(".dropveil");
  // A text drag has no "Files" type.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "selected text");
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, cancelable: true }));
  });
  await expect(veil).toHaveCount(0);
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "selected text");
    const e = new DragEvent("drop", { dataTransfer: dt, cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(false);

  // A file drag still shows it, and the drop is read (a .txt is told to choose a .glb).
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["hello"], "note.txt", { type: "text/plain" }));
    return d;
  });
  await page.dispatchEvent("body", "dragenter", { dataTransfer: dt });
  await expect(veil).toBeVisible();
  await page.dispatchEvent("body", "drop", { dataTransfer: dt });
  await expect(veil).toHaveCount(0);
  await expect(page.locator(".loadmsg:not(:empty)")).toHaveText("Choose a .glb file or a design .json.");
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("View popover placement", () => {
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [900, 800],
    [390, 844],
  ]) {
    test(`${width}×${height}: clear of the island and the summary bar, inside the window`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openApp(page);
      await viewButton(page).click();
      const box = (await pop(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      if (width > 980) {
        // Desktop: the right edge is at the island's left edge, never over the scorecard.
        const island = (await page.locator("#island").boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(island.x);
      } else {
        const summary = (await page.locator(".summary").boundingBox())!;
        expect(overlaps(box, summary)).toBe(false);
      }
      // The surface is near-opaque.
      const bg = await pop(page).evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(bg).toMatch(/rgba\(\d+, \d+, \d+, 0\.9\d\)/);
      await page.screenshot({ path: `e2e/screenshots/31-view-popover-${width}x${height}.png` });
    });
  }
});

const toast = (page: Page) => page.locator(".loadrow");
const toastText = (page: Page) => page.locator(".loadrow .loadmsg:not(:empty)");

/** The toast hangs under the header: inside the window, clear of the island and below the header. */
async function expectToastPlaced(page: Page) {
  const box = (await toast(page).boundingBox())!;
  const header = (await page.locator("header.tl").boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  if (vp.width > 980) {
    const island = (await page.locator("#island").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(island.x);
  }
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
]) {
  test(`${width}x${height}: a bad file shows an error toast (an alert) that stays until dismissed`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.locator('#island input[type="file"]').setInputFiles({ name: "bad.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("not a model") });
    await expect(page.getByRole("alert").filter({ hasText: "That isn't a .glb file. Choose a .glb or a design .json." })).toBeVisible();
    await expectToastPlaced(page);
    expect(await toastText(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
    await page.screenshot({ path: `e2e/screenshots/31-load-error-${width}x${height}.png` });
    // Errors don't go by themselves.
    await page.waitForTimeout(500);
    await expect(toastText(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Dismiss the message" }).click();
    await expect(toastText(page)).toHaveCount(0);
  });

  test(`${width}x${height}: a note shows in the same toast (a status) and goes by itself`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    // Open a design file that was saved from this crate: "Design loaded: ...".
    if (width <= 980) await page.getByRole("button", { name: "Crate details" }).click();
    await page.getByRole("tab", { name: "Cut list" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download design (.json)" }).click(),
    ]);
    const text = readFileSync((await download.path())!, "utf8");
    await page.locator('#island input[type="file"]').setInputFiles({ name: "crate-design.json", mimeType: "application/json", buffer: Buffer.from(text) });
    const note = page.getByRole("status").filter({ hasText: "Design loaded: 4 × Machined steel bracket." });
    await expect(note).toBeVisible();
    if (width <= 980) await page.getByRole("button", { name: "Close the panel" }).click();
    await expectToastPlaced(page);
    await page.screenshot({ path: `e2e/screenshots/31-load-note-${width}x${height}.png` });
    // A note goes by itself.
    await expect(toastText(page)).toHaveCount(0, { timeout: 15_000 });
  });
}

test("the Export pill notes cautions with a dot, a title and a description; none without", async ({ page }) => {
  await openApp(page);
  const pill = page.getByRole("button", { name: /Export specs/ });
  await expect(pill.locator(".exportdot")).toHaveCount(0);
  await expect(pill).not.toHaveAttribute("title", /caution/);
  // A model with no catalog data comes with a stand-in mass: a caution.
  await page.locator('#island input[type="file"]').setInputFiles(sampleFile("PART-001-machined-steel-bracket.glb", "custom_widget.glb"));
  await expect(pill.locator(".exportdot")).toHaveCount(1);
  await expect(pill).toHaveAttribute("title", /\d caution.*see Checks/);
  await expect(pill).toHaveAccessibleDescription(/\d cautions?, see Checks/);
  await expect(pill).toBeEnabled();
  await page.screenshot({ path: "e2e/screenshots/31-export-caution.png" });
});
