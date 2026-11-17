import { expect, test } from "@playwright/test";
import { openApp, openTab } from "./helpers";

// The narrow-screen drawer is modal: Tab cycles inside it, and that cycle includes the
// <summary> of a collapsed <details> (Shop standards, the last thing on the Rules tab).

test("the drawer's focus trap reaches Shop standards and opens it from the keyboard", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Crate details" }).tap();
  await expect(page.getByRole("dialog", { name: "Crate details" })).toBeVisible();
  await openTab(page, "Rules");

  const standards = page.locator("summary", { hasText: "Shop standards" });
  await expect(standards).toBeVisible();

  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await standards.evaluate((el) => el === document.activeElement);
    // Focus never leaves the drawer.
    expect(await page.evaluate(() => !!document.activeElement?.closest("aside"))).toBe(true);
  }
  expect(reached, "Tab reached the Shop standards summary").toBe(true);

  await page.keyboard.press("Enter");
  await expect(page.locator("details", { has: standards })).toHaveAttribute("open", "");

  // One more lap: Tab from the end still wraps inside the drawer.
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("aside"))).toBe(true);
});
