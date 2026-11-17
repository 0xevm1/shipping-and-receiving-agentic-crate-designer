import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, panel, pollCrate, shot, tab } from "./helpers";

// A batch split across crates (#25) on a phone: the closed-drawer summary shows the size of the
// crate type on screen and the whole shipment's gross.

const burger = (page: Page) => page.getByRole("button", { name: "Crate details" });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Crate details" });
const closeBtn = (page: Page) => page.getByRole("button", { name: "Close the panel" });
const summary = (page: Page) => page.locator(".summary");

test("the summary chip reads as a shipment for a split batch", async ({ page }) => {
  await openApp(page);
  await burger(page).tap();
  await expect(drawer(page)).toBeVisible();
  await tab(page, "Rules").tap();
  await panel(page).getByLabel("Quantity").fill("200");
  await pollCrate(page, (s) => s.quantity).toBe(200);
  const s = await crate(page);
  const crates = s.crateTypes.reduce((n, c) => n + c.count, 0);
  expect(crates).toBeGreaterThan(1);

  await tab(page, "Overview").tap();
  await expect(panel(page).getByRole("region", { name: "Shipment" })).toContainText("Ships as");
  await shot(page, `25-${test.info().project.name}-drawer-overview`);

  await closeBtn(page).tap();
  await expect(drawer(page)).toBeHidden();
  await expect(summary(page)).toContainText("Crate A outside");
  await expect(summary(page)).toContainText(`Gross, ${crates} crates`);
  await shot(page, `25-${test.info().project.name}-closed-summary`);
});
