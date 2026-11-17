import { expect, test } from "@playwright/test";
import {
  burger,
  closeDrawerButton,
  crate,
  drawer,
  expectInsideViewport,
  expectNoPageScroll,
  expectTouchSize,
  fileInput,
  header,
  hidePanelsButton,
  island,
  openApp,
  openDrawer,
  openTab,
  panel,
  pinnedRow,
  pollCrate,
  sampleFile,
  scrim,
  screenBox,
  SHAFT,
  shot,
  standards,
  summary,
  tab,
} from "./helpers";

// Phone projects: mobile-390 (390 × 844) and mobile-360 (360 × 800), with touch. The scene is
// full-bleed and the island is a right-side drawer behind a hamburger (spec §8.2).

test("the drawer opens from the hamburger; scrim, Escape and the close button dismiss it; focus is trapped and restored", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await expect(drawer(page)).toHaveAttribute("aria-modal", "true");
  await expect(closeDrawerButton(page)).toBeFocused();
  const box = (await drawer(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x + box.width).toBeCloseTo(vp.width, 0);
  expect(box.width).toBeLessThanOrEqual(Math.min(0.9 * vp.width, 440) + 1);
  expect(box.width).toBeGreaterThanOrEqual(0.85 * vp.width - 1);
  // The crate is still there behind the scrim, and idle rotation holds.
  expect((await crate(page)).drawerOpen).toBe(true);
  await shot(page, "drawer-overview");

  // Focus is trapped: Tab from the last control wraps to the first, Shift+Tab back again.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await closeDrawerButton(page).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await expect(closeDrawerButton(page)).not.toBeFocused();

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
  await closeDrawerButton(page).tap();
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toBeFocused();
  expect((await crate(page)).drawerOpen).toBe(false);
});

test("the focus trap reaches Shop standards and opens it from the keyboard", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await openTab(page, "Rules");

  // The trap's cycle includes the <summary> of a collapsed <details>, the last thing on the Rules tab.
  const summaryEl = standards(page).locator("summary");
  await expect(summaryEl).toBeVisible();

  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await summaryEl.evaluate((el) => el === document.activeElement);
    // Focus never leaves the drawer.
    expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  expect(reached, "Tab reached the Shop standards summary").toBe(true);

  await page.keyboard.press("Enter");
  await expect(standards(page)).toHaveAttribute("open", "");

  // One more lap: Shift+Tab still stays inside the drawer.
  await page.keyboard.press("Shift+Tab");
  expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
});

test("every tab works inside the drawer and only the panel scrolls", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  for (const t of ["Overview", "Layouts", "Cut list", "Rules", "Checks"]) {
    await tab(page, t).tap();
    await expect(tab(page, t)).toHaveAttribute("aria-selected", "true");
    await expect(panel(page)).toBeVisible();
    await expectNoPageScroll(page);
    await expectInsideViewport(page, island(page), "the island");
  }
  // The cut list is longer than the panel, and the panel scrolls it.
  await tab(page, "Cut list").tap();
  const p = panel(page);
  await expect(p).toHaveCSS("overflow-y", "auto");
  const sizes = await p.evaluate((el) => ({ scrollH: el.scrollHeight, h: el.clientHeight }));
  expect(sizes.scrollH).toBeGreaterThan(sizes.h);
  await p.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await p.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expectNoPageScroll(page);

  // Touch targets in the drawer's chrome are at least 44 px.
  await expectTouchSize(page, [closeDrawerButton(page), page.getByRole("button", { name: "Load a part" }), tab(page, "Rules")]);
});

test("tapping a board opens the drawer on the Cut list at that row", async ({ page }) => {
  await openApp(page);
  // The crate is centred between the header and the foot; its middle is the closed front wall.
  const head = await screenBox(header(page));
  const foot = await screenBox(summary(page));
  const vp = page.viewportSize()!;
  await page.touchscreen.tap(vp.width / 2, (head.bottom + foot.top) / 2);

  await expect(drawer(page)).toBeVisible();
  await expect(tab(page, "Cut list")).toHaveAttribute("aria-selected", "true");
  expect((await crate(page)).pin).not.toBeNull();
  const row = pinnedRow(page);
  await expect(row).toHaveCount(1);
  await expect(row).toBeInViewport();
  await shot(page, "drawer-cut-list-pinned");

  // Closing keeps the pin; the pin bar offers "Show everything".
  await closeDrawerButton(page).tap();
  await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible();
  await expectNoPageScroll(page);
});

test("Load a part works from the drawer", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(header(page)).toContainText("PART-002 · Long steel shaft");
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
  await expect(scrim(page)).toHaveCount(0);
  await expect(burger(page)).toBeHidden();
  await expect(summary(page)).toBeHidden();
  await pollCrate(page, (s) => s.drawerOpen).toBe(false);
  await expect(hidePanelsButton(page)).toBeVisible();

  // Hide panels on desktop doesn't carry into the drawer layout, where it has no pill.
  await hidePanelsButton(page).click();
  await page.setViewportSize(vp);
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toHaveAttribute("aria-expanded", "false");
  await pollCrate(page, (s) => s.panelsHidden).toBe(false);
  await expect(header(page)).toBeVisible();
  await expectNoPageScroll(page);

  // Landscape: still the drawer layout, nothing scrolls, the drawer fits the height.
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await expect(burger(page)).toBeVisible();
  await expect(summary(page)).toBeVisible();
  await expectNoPageScroll(page);
  await openDrawer(page);
  await expectInsideViewport(page, island(page), "the island");
  await expect(panel(page)).toBeVisible();
  await page.setViewportSize(vp);
  await expect(drawer(page)).toBeVisible();
  await expectNoPageScroll(page);
});

test("all five tabs fit the drawer without scrolling or clipping, with a caution badge on Checks", async ({ page }) => {
  await openApp(page);
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await expect(tab(page, "Checks").getByTestId("caution-count")).toBeVisible();
  await openDrawer(page);
  const strip = drawer(page).getByRole("tablist");
  const fits = await strip.evaluate((el) => {
    const right = el.getBoundingClientRect().right;
    return {
      overflow: el.scrollWidth - el.clientWidth,
      past: Math.max(...[...el.querySelectorAll("button")].map((b) => b.getBoundingClientRect().right)) - right,
    };
  });
  expect(fits.overflow).toBeLessThanOrEqual(0);
  expect(fits.past).toBeLessThanOrEqual(0);
  await expectTouchSize(
    page,
    ["Overview", "Layouts", "Cut list", "Rules", "Checks"].map((name) => tab(page, name)),
  );
});

test("scrolling the drawer folds the part thumbnail away and returns it at the top; the credit scrolls with the content", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await openTab(page, "Cut list");
  const thumb = drawer(page).getByRole("group", { name: /The part on its own/ });
  const credit = drawer(page).getByLabel("Hadrian × Eric White, interview candidate");
  await expect(thumb).toBeVisible();
  // The credit is the last thing in the scrolling panel, not pinned under it.
  await expect(credit).not.toBeInViewport();
  const tabpanel = panel(page);
  await tabpanel.evaluate((el) => el.scrollTo(0, 120));
  await expect(thumb).toBeHidden();
  await tabpanel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(credit).toBeInViewport();
  await tabpanel.evaluate((el) => el.scrollTo(0, 0));
  await expect(thumb).toBeVisible();
});
