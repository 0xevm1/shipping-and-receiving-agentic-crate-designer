import { expect, type Page } from "@playwright/test";
import { crate, pollCrate } from "./helpers";

/** Shared by the #62 layout specs (27-*): measuring the 3D view's arrow against the width label. */

type Box = { left: number; top: number; right: number; bottom: number };

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The crate's width size label ("25.7 in"): the second crate label (length, width, height). */
async function widthLabelBox(page: Page): Promise<Box> {
  const r = await page.getByTestId("size-labels").locator(".dim:not(.inner)").nth(1).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  });
  return r;
}

/** The near-end fork arrow and the width label share no screen pixels (#62). */
export async function expectArrowClearOfWidthLabel(page: Page) {
  await pollCrate(page, (c) => c.cog?.arrowBox != null).toBe(true);
  // A few frames, so the labels have been positioned for the current camera.
  await page.waitForTimeout(500);
  const arrow = (await crate(page)).cog!.arrowBox!;
  const label = await widthLabelBox(page);
  expect(label.right - label.left, "width label is on screen").toBeGreaterThan(20);
  expect(overlaps(arrow, label), `arrow ${JSON.stringify(arrow)} vs label ${JSON.stringify(label)}`).toBe(false);
}

/** Steps the view to exploded (closed, open, exploded) and back to closed. */
export async function explode(page: Page) {
  await page.getByRole("button", { name: /view\. Click for/ }).click();
  await page.getByRole("button", { name: /view\. Click for/ }).click();
  await pollCrate(page, (c) => c.anim.explode).toBe(1);
}

export async function closeView(page: Page) {
  await page.getByRole("button", { name: /view\. Click for/ }).click();
  await pollCrate(page, (c) => c.mode).toBe("closed");
}
