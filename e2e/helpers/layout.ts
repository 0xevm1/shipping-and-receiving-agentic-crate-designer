import { expect, type Page } from "@playwright/test";
import { crateLabels, cutTable, overlaps, panel, screenBox } from "./locators";
import { crate, pollCrate, waitForFrames } from "./probe";

/** The document doesn't scroll: only the island panel does. */
export async function expectNoPageScroll(page: Page) {
  const doc = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollH: el.scrollHeight, scrollW: el.scrollWidth, h: window.innerHeight, w: window.innerWidth };
  });
  expect(doc.scrollH, "vertical page scroll").toBeLessThanOrEqual(doc.h);
  expect(doc.scrollW, "horizontal page scroll").toBeLessThanOrEqual(doc.w);
}

/** Every element matching `locator` that has a box lies inside the viewport. */
export async function expectInsideViewport(page: Page, locator: ReturnType<Page["locator"]>, what: string) {
  const vp = page.viewportSize()!;
  const outside: string[] = [];
  for (const el of await locator.all()) {
    const b = await el.boundingBox();
    if (!b || b.width === 0) continue;
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > vp.width + 0.5 || b.y + b.height > vp.height + 0.5) {
      outside.push(`${Math.round(b.x)},${Math.round(b.y)} → ${Math.round(b.x + b.width)},${Math.round(b.y + b.height)}`);
    }
  }
  expect(outside, `${what} outside the viewport`).toEqual([]);
}

/** Touch targets are at least 44 px in their smaller dimension. */
export async function expectTouchSize(page: Page, locators: ReturnType<Page["locator"]>[]) {
  for (const el of locators) {
    const b = (await el.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
}

/** The near-end fork arrow and the crate's width label share no screen pixels. */
export async function expectArrowClearOfWidthLabel(page: Page) {
  await pollCrate(page, (c) => c.cog?.arrowBox != null).toBe(true);
  // A few frames, so the labels have been positioned for the current camera.
  await waitForFrames(page, 3);
  const arrow = (await crate(page)).cog!.arrowBox!;
  // The crate's labels are length, width, height: the width label is the second.
  const label = await screenBox(crateLabels(page).nth(1));
  expect(label.right - label.left, "width label is on screen").toBeGreaterThan(20);
  expect(overlaps(arrow, label), `arrow ${JSON.stringify(arrow)} vs label ${JSON.stringify(label)}`).toBe(false);
}

/** How far the Qty column's right edge is inside the panel's right padding, and whether the panel scrolls sideways. */
export async function qtyColumnFit(page: Page) {
  const cells = [cutTable(page).getByRole("columnheader", { name: "Qty" }), ...(await cutTable(page).getByTestId("cut-qty").all())];
  let right = -Infinity;
  for (const c of cells) {
    const b = await c.boundingBox();
    if (b && b.width > 0) right = Math.max(right, b.x + b.width);
  }
  const panelFit = await panel(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { right: r.right - parseFloat(getComputedStyle(el).paddingRight), overflow: el.scrollWidth - el.clientWidth };
  });
  return { room: panelFit.right - right, overflow: panelFit.overflow, cells: cells.length };
}
