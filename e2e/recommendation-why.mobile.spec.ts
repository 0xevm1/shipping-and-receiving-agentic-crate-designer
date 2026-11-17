import { expect, test } from "@playwright/test";
import { crate, expectTouchSize, openApp, openDrawer, openTab, panel, shot } from "./helpers";

// Phone projects: "Why this crate?" opens inside the drawer, with no sideways scroll.

test("Why this crate? opens in the drawer and fits it", async ({ page }) => {
  await openApp(page);
  const { quantity } = await crate(page);
  await openDrawer(page);
  await openTab(page, "Rules");
  const toggle = panel(page).getByRole("button", { name: "Why this crate?" });
  await expectTouchSize(page, [toggle]);
  await toggle.click();
  const why = panel(page).getByRole("region", { name: "Why this crate?" });
  await expect(why.getByRole("heading", { name: `Why ${quantity} per crate` })).toBeVisible();
  await expect(why.getByRole("img", { name: /Cost per part by quantity per crate/ })).toBeVisible();
  const p = panel(page);
  expect(await p.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await why.getByRole("heading", { name: "What stopped a larger crate" }).scrollIntoViewIfNeeded();
  await shot(page, "recommendation-why-mobile");
});
