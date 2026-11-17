import { expect, test } from "@playwright/test";
import { closeDrawerButton, crate, drawer, openApp, openDrawer, openTab, panel, pollCrate, shot, summary } from "./helpers";

// A batch split across crates on a phone: the closed-drawer summary shows the size of the
// crate type on screen and the whole shipment's gross.

test("the summary chip reads as a shipment for a split batch", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("200");
  await pollCrate(page, (s) => s.quantity).toBe(200);
  const crates = (await crate(page)).crateTypes.reduce((n, c) => n + c.count, 0);
  expect(crates).toBeGreaterThan(1);

  await openTab(page, "Overview");
  await expect(panel(page).getByRole("region", { name: "Shipment" })).toContainText("Ships as");
  await shot(page, "batch-split-drawer-overview");

  await closeDrawerButton(page).tap();
  await expect(drawer(page)).toBeHidden();
  await expect(summary(page)).toContainText("Crate A outside");
  await expect(summary(page)).toContainText(`Gross, ${crates} crates`);
  await shot(page, "batch-split-closed-summary");
});
