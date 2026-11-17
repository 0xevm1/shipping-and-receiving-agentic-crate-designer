import { expect, test } from "@playwright/test";
import {
  expectInsideViewport,
  expectNoPageScroll,
  expectTouchSize,
  modeButton,
  openApp,
  pollCrate,
  screenBox,
  shot,
  summary,
  viewButton,
  viewPopover,
} from "./helpers";

/** The view bar and its popover on a phone (mobile-390 and mobile-360), with touch. */

test("the view bar and the View popover fit on screen, at touch size", async ({ page }) => {
  await openApp(page);
  const bar = page.getByTestId("view-bar");
  await expectInsideViewport(page, bar, "the view bar");
  await expectInsideViewport(page, bar.locator(":scope > *"), "the view bar's controls");
  await expectInsideViewport(page, summary(page), "the summary chip");
  await expectTouchSize(page, [modeButton(page), viewButton(page)]);

  await viewButton(page).tap();
  await expect(viewPopover(page)).toBeVisible();
  // It opens upward, above the bar, and stays inside the viewport.
  expect((await screenBox(viewPopover(page))).bottom).toBeLessThanOrEqual((await screenBox(bar)).top);
  await expectInsideViewport(page, viewPopover(page), "the View popover");
  await expectNoPageScroll(page);
  await viewPopover(page).getByRole("button", { name: "Top" }).tap();
  await pollCrate(page, (s) => s.view.camera).toBe("top");
  await shot(page, "view-popover-mobile");
});

test("the popover shows the touch wording, not the mouse wording", async ({ page }) => {
  await openApp(page);
  await viewButton(page).tap();
  const pop = viewPopover(page);
  await expect(pop.getByTestId("hint-touch")).toBeVisible();
  await expect(pop.getByTestId("hint-touch")).toContainText("two fingers to pan");
  await expect(pop.getByTestId("hint-mouse")).toBeHidden();
  await expect(page.getByTestId("view-hint")).toHaveCount(0);
});
