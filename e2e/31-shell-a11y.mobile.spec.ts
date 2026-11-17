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

test("the summary chip is the width of the foot, with a gap between size and weight, at any quantity", async ({ page }) => {
  await openApp(page);
  const summary = page.locator(".summary");
  const measure = () =>
    summary.evaluate((el) => {
      const foot = el.parentElement!.getBoundingClientRect();
      const [size, weight] = [...el.querySelectorAll(".summary-val")].map((v) => v.getBoundingClientRect());
      return { chip: Math.round(el.getBoundingClientRect().width), foot: Math.round(foot.width), gap: weight.left - size.right };
    });
  const before = await measure();
  expect(before.chip).toBe(before.foot);
  expect(before.gap).toBeGreaterThanOrEqual(8);

  await page.getByRole("button", { name: "Crate details" }).tap();
  await openTab(page, "Rules");
  await page.getByRole("tabpanel").getByLabel("Quantity").fill("200");
  await page.getByRole("button", { name: "Close the panel" }).tap();
  await expect(summary).toContainText("crates");
  const after = await measure();
  expect(after.chip).toBe(before.chip);
  expect(after.gap).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: `e2e/screenshots/31-summary-chip-${test.info().project.name}.png` });
});
