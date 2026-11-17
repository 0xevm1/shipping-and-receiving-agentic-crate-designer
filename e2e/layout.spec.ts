import { expect, test } from "@playwright/test";
import { openApp, openTab, panel, shot } from "./helpers";

// Desktop project (1440 × 900); the narrow drawer layout is in 08-layout.narrow.spec.ts and 12-mobile.mobile.spec.ts.
test("at 1440 × 900 only the island panel scrolls", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");

  const doc = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollH: el.scrollHeight, scrollW: el.scrollWidth, h: window.innerHeight, w: window.innerWidth };
  });
  expect(doc.scrollH).toBeLessThanOrEqual(doc.h);
  expect(doc.scrollW).toBeLessThanOrEqual(doc.w);

  // The cut list is longer than the panel, and the panel scrolls it.
  const p = panel(page);
  await expect(p).toHaveCSS("overflow-y", "auto");
  const sizes = await p.evaluate((el) => ({ scrollH: el.scrollHeight, h: el.clientHeight }));
  expect(sizes.scrollH).toBeGreaterThan(sizes.h);
  await p.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await p.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await shot(page, "08-desktop-panel-scrolled");
});
