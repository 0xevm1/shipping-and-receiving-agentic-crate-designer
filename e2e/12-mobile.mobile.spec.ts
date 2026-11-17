import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, panel, pollCrate, sampleFile, shot, tab } from "./helpers";

// Phone projects (#42): mobile-390 (390 × 844) and mobile-360 (360 × 800), with touch. The scene
// is full-bleed, the island is a right-side drawer behind a hamburger (spec §8.2).

const burger = (page: Page) => page.getByRole("button", { name: "Crate details" });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Crate details" });
const closeBtn = (page: Page) => page.getByRole("button", { name: "Close the panel" });
const summary = (page: Page) => page.locator(".summary");
const name = (suffix: string) => `42-${test.info().project.name}-${suffix}`;

async function noPageScroll(page: Page) {
  const doc = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollH: el.scrollHeight, scrollW: el.scrollWidth, h: window.innerHeight, w: window.innerWidth };
  });
  expect(doc.scrollH, "vertical page scroll").toBeLessThanOrEqual(doc.h);
  expect(doc.scrollW, "horizontal page scroll").toBeLessThanOrEqual(doc.w);
}

/** Every box lies inside the viewport. */
async function insideViewport(page: Page, selector: string) {
  const out = await page.evaluate((sel) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    return [...document.querySelectorAll(sel)]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5))
      .map((r) => `${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}`);
  }, selector);
  expect(out, `${selector} outside the viewport`).toEqual([]);
}

async function openDrawer(page: Page) {
  await burger(page).tap();
  await expect(drawer(page)).toBeVisible();
  await expect(burger(page)).toHaveAttribute("aria-expanded", "true");
}

test("the scene fills the screen with the answer on it, and the page doesn't scroll", async ({ page }) => {
  await openApp(page);
  await noPageScroll(page);

  // The canvas is full-bleed and draws.
  const stage = (await page.getByRole("region", { name: "3D view of the crate" }).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(stage).toMatchObject({ x: 0, y: 0, width: vp.width, height: vp.height });
  expect(await page.evaluate(() => window.__crate!.canvasCoverage())).toBeGreaterThan(0.05);

  // The crate is fully visible: its size labels sit between the header and the foot.
  const header = (await page.getByRole("banner").boundingBox())!;
  const foot = (await summary(page).boundingBox())!;
  const labels = await page.getByTestId("size-labels").locator(".dim").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })),
  );
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) {
    expect(l.l).toBeGreaterThanOrEqual(0);
    expect(l.r).toBeLessThanOrEqual(vp.width);
    expect(l.t).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(l.b).toBeLessThanOrEqual(foot.y + 1);
  }

  // The answer without opening anything: outside size and gross weight, in amber.
  await expect(summary(page)).toBeVisible();
  await expect(summary(page)).toContainText("932 × 652 × 497 mm");
  await expect(summary(page)).toContainText(/Gross\s*\d+ kg/);
  await expect(summary(page).locator(".summary-val").first()).toHaveCSS("color", "rgb(243, 160, 0)");

  // The island is a closed drawer; Hide panels is desktop-only.
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(burger(page)).toHaveAttribute("aria-controls", "island");
  await expect(page.getByRole("button", { name: /Hide panels/ })).toBeHidden();
  await shot(page, name("closed-summary"));
});

test("the drawer opens from the hamburger; scrim, Escape and the close button dismiss it; focus is trapped and restored", async ({
  page,
}) => {
  await openApp(page);
  await openDrawer(page);
  await expect(drawer(page)).toHaveAttribute("aria-modal", "true");
  await expect(closeBtn(page)).toBeFocused();
  const box = (await drawer(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x + box.width).toBeCloseTo(vp.width, 0);
  expect(box.width).toBeLessThanOrEqual(Math.min(0.9 * vp.width, 440) + 1);
  expect(box.width).toBeGreaterThanOrEqual(0.85 * vp.width - 1);
  // The crate is still there behind the scrim, and idle rotation holds.
  expect((await crate(page)).drawerOpen).toBe(true);
  await shot(page, name("drawer-overview"));

  // Focus is trapped: Tab from the last control wraps to the first, Shift+Tab back again.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await closeBtn(page).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await expect(closeBtn(page)).not.toBeFocused();

  // Escape closes it and focus goes back to the hamburger.
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(burger(page)).toBeFocused();

  // Tapping the scrim (left of the drawer) closes it.
  await openDrawer(page);
  await page.touchscreen.tap(12, vp.height / 2);
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toBeFocused();

  // So does the close button.
  await openDrawer(page);
  await closeBtn(page).tap();
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toBeFocused();
  expect((await crate(page)).drawerOpen).toBe(false);
});

test("every tab works inside the drawer and only the panel scrolls", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  for (const t of ["Overview", "Layouts", "Cut list", "Rules", "Checks"]) {
    await tab(page, t).tap();
    await expect(tab(page, t)).toHaveAttribute("aria-selected", "true");
    await expect(panel(page)).toBeVisible();
    await noPageScroll(page);
    await insideViewport(page, "#island");
  }
  // The cut list is longer than the panel, and the panel scrolls it.
  await tab(page, "Cut list").tap();
  const p = panel(page);
  await expect(p).toHaveCSS("overflow-y", "auto");
  const sizes = await p.evaluate((el) => ({ scrollH: el.scrollHeight, h: el.clientHeight }));
  expect(sizes.scrollH).toBeGreaterThan(sizes.h);
  await p.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await p.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await noPageScroll(page);

  // Touch targets in the drawer's chrome are at least 44 px.
  for (const el of [closeBtn(page), page.getByRole("button", { name: "Load a part" }), tab(page, "Rules")]) {
    const b = (await el.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
});

test("tapping a board opens the drawer on the Cut list at that row", async ({ page }) => {
  await openApp(page);
  // The crate is centred between the header and the foot; its middle is the closed front wall.
  const header = (await page.getByRole("banner").boundingBox())!;
  const foot = (await summary(page).boundingBox())!;
  const vp = page.viewportSize()!;
  await page.touchscreen.tap(vp.width / 2, (header.y + header.height + foot.y) / 2);

  await expect(drawer(page)).toBeVisible();
  await expect(tab(page, "Cut list")).toHaveAttribute("aria-selected", "true");
  const pin = (await crate(page)).pin;
  expect(pin).not.toBeNull();
  const row = panel(page).locator("tr.row.pin");
  await expect(row).toHaveCount(1);
  await expect(row).toBeInViewport();
  await shot(page, name("drawer-cutlist-pinned"));

  // Closing keeps the pin; the pin bar offers "Show everything".
  await closeBtn(page).tap();
  await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible();
  await noPageScroll(page);
});

test("the view bar and the View popover fit on screen", async ({ page }) => {
  await openApp(page);
  const bar = page.locator(".br");
  await insideViewport(page, ".br, .br > *, .summary");
  for (const el of [page.getByRole("button", { name: /view\. Click for/ }), bar.getByRole("button", { name: "View", exact: true })]) {
    const b = (await el.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }

  await bar.getByRole("button", { name: "View", exact: true }).tap();
  const pop = page.locator("#view-pop");
  await expect(pop).toBeVisible();
  // It opens upward, above the bar, and stays inside the viewport.
  const popBox = (await pop.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(popBox.y + popBox.height).toBeLessThanOrEqual(barBox.y);
  await insideViewport(page, "#view-pop");
  await noPageScroll(page);
  await pop.getByRole("button", { name: "Top" }).tap();
  await pollCrate(page, (s) => s.view.camera).toBe("top");
  await shot(page, name("view-popover"));
});

test("Load a part works from the drawer", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await drawer(page).locator('input[type="file"]').setInputFiles(sampleFile("PART-002-long-steel-shaft.glb"));
  await expect(page.getByRole("banner")).toContainText("PART-002 · Long steel shaft");
  await expect(drawer(page).getByRole("heading", { level: 2 }).first()).toHaveText("Long steel shaft");
  await pollCrate(page, (s) => s.partId).toBe("PART-002");
});

test("resizing across 980 px and rotating to landscape switch cleanly", async ({ page }) => {
  await openApp(page);
  const vp = page.viewportSize()!;
  await openDrawer(page);

  // Wider than 980 px: the desktop island, no dialog, no scrim, no stuck open state.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("complementary")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".scrim")).toHaveCount(0);
  await expect(burger(page)).toBeHidden();
  await expect(summary(page)).toBeHidden();
  await pollCrate(page, (s) => s.drawerOpen).toBe(false);
  await expect(page.getByRole("button", { name: "Hide panels" })).toBeVisible();

  // Hide panels on desktop doesn't carry into the drawer layout, where it has no pill.
  await page.getByRole("button", { name: "Hide panels" }).click();
  await page.setViewportSize(vp);
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toHaveAttribute("aria-expanded", "false");
  await pollCrate(page, (s) => s.panelsHidden).toBe(false);
  await expect(page.getByRole("banner")).toHaveCSS("opacity", "1");
  await noPageScroll(page);

  // Landscape: still the drawer layout, nothing scrolls, the drawer fits the height.
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await expect(burger(page)).toBeVisible();
  await expect(summary(page)).toBeVisible();
  await noPageScroll(page);
  await openDrawer(page);
  await insideViewport(page, "#island");
  await expect(panel(page)).toBeVisible();
  await page.setViewportSize(vp);
  await expect(drawer(page)).toBeVisible();
  await noPageScroll(page);
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("idle rotation holds while the drawer is open", async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page);
    await openDrawer(page);
    // Longer than the 6 s idle delay, with no input.
    await page.waitForTimeout(7500);
    expect((await crate(page)).autoplay).toBe(false);
    await closeBtn(page).tap();
    await pollCrate(page, (s) => s.autoplay, { timeout: 30_000 }).toBe(true);
  });
});
