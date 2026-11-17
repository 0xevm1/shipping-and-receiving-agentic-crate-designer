import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

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
  await expect(page.locator(".loadmsg")).toHaveText("Choose a .glb file.");
});
