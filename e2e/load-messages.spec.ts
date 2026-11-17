import { expect, test, type Page } from "@playwright/test";
import {
  burger,
  closeDrawerButton,
  fileInput,
  header,
  jsonFile,
  loadMessage,
  loadToast,
  openApp,
  openTab,
  readDownloadText,
  screenBox,
  shot,
  waitForFrames,
} from "./helpers";

/**
 * The load toast: a note (status) goes by itself, an error (alert) waits to be dismissed; both stay clear
 * of the island, the header and the window edge, on a desktop (beside the app name, above the crate's
 * band) and a phone (under the header).
 */

const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const narrow = (width: number) => width <= 980;

/** Phone: under the header. Desktop: beside it, level with the app name, so it never hangs over the crate. Always inside the window and clear of the island. */
async function expectToastPlaced(page: Page) {
  const box = await screenBox(loadToast(page));
  const head = await screenBox(header(page));
  const vp = page.viewportSize()!;
  if (narrow(vp.width)) expect(box.top).toBeGreaterThanOrEqual(head.bottom);
  else {
    expect(box.left).toBeGreaterThanOrEqual(head.right);
    // Level with the app name and well above the export pill's row, where the crate's top-left corner reaches.
    expect(box.top).toBeLessThan(head.top + 40);
    expect(box.bottom).toBeLessThan(head.bottom);
  }
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(vp.width);
  if (!narrow(vp.width)) expect(box.right).toBeLessThanOrEqual((await screenBox(page.getByRole("complementary"))).left);
}

for (const { width, height } of SIZES) {
  test.describe(`${width}x${height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openApp(page);
    });

    test("a bad file shows an error toast (an alert) that stays until dismissed", async ({ page }) => {
      await fileInput(page).setInputFiles({ name: "bad.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("not a model") });
      await expect(page.getByRole("alert").filter({ hasText: "bad.glb can't be opened. It has a .glb name but isn't a binary glTF." })).toBeVisible();
      await expectToastPlaced(page);
      expect(await loadMessage(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
      await shot(page, `load-messages-error-${width}x${height}`);
      // Errors don't go by themselves: still there a few frames later.
      await waitForFrames(page, 3);
      await expect(loadMessage(page)).toHaveCount(1);
      await page.getByRole("button", { name: "Dismiss the message" }).click();
      await expect(loadMessage(page)).toHaveCount(0);
    });

    test("a note shows in the same toast (a status)", async ({ page }) => {
      // Open a design file that was saved from this crate: "Design loaded: ...".
      if (narrow(width)) await burger(page).click();
      await openTab(page, "Cut list");
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download design (.json)" }).click()]);
      await fileInput(page).setInputFiles(jsonFile(await readDownloadText(download)));
      await expect(page.getByRole("status").filter({ hasText: "Design loaded: 4 × Machined steel bracket." })).toBeVisible();
      if (narrow(width)) await closeDrawerButton(page).click();
      await expectToastPlaced(page);
      await shot(page, `load-messages-note-${width}x${height}`);
    });
  });
}

test("a note goes by itself after a few seconds", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download design (.json)" }).click()]);
  await fileInput(page).setInputFiles(jsonFile(await readDownloadText(download)));
  await expect(loadMessage(page, "Design loaded")).toBeVisible();
  // The toast clears itself after NOTE_DISMISS_MS (9 s).
  await expect(loadMessage(page)).toHaveCount(0, { timeout: 20_000 });
});
