import { expect, test, type Page } from "@playwright/test";
import { fileInput, island, openApp, openTab, panel, sampleFile, setUnits, shot } from "./helpers";
import { closeView, explode, expectArrowClearOfWidthLabel } from "./27-layout-helpers";

/**
 * UI review layout fixes (#62), desktop: the short change note, the header note on one line,
 * the cut list's Qty column, plain "4x4" next to a true "×", and the fork arrow clear of the
 * width label. Phone sizes are in 27-ui-review-layout.mobile.spec.ts.
 */

const header = (page: Page) => page.getByRole("banner");
const islandNote = (page: Page) => island(page).locator(".island-note");

async function setQuantity(page: Page, n: number) {
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill(String(n));
  await panel(page).getByLabel("Quantity").blur();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("a big edit gets a short note, with the full before and after on hover and for screen readers", async ({ page }) => {
  await setUnits(page, "metric");
  await setQuantity(page, 200);
  const note = islandNote(page);
  await expect(note).toHaveText(/^Crate grew: \d+ × \d+ × \d+ mm, \d+ kg/);
  // The visible text is short; the detail (every change, before → after) is the title and hidden text.
  const visible = await note.locator("> span").evaluate((el) => (el.firstChild as Text).data);
  expect(visible.length).toBeLessThan(50);
  await expect(note.locator("> span")).toHaveAttribute("title", /^Gross \d+ → \d+ kg, outside 932 × 652 × 497 → \d+ × \d+ × \d+ mm/);
  await expect(note.locator(".sr-only")).toContainText("Details: Gross");
  await shot(page, "27-short-change-note");

  // Imperial says it in inches and pounds.
  await setUnits(page, "imperial");
  await setQuantity(page, 4);
  await expect(note).toHaveText(/^Crate shrank: [\d.]+ × [\d.]+ × [\d.]+ in, \d+ lb/);
});

test("the header note stays on one line at quantity 200", async ({ page }) => {
  await setUnits(page, "metric");
  await fileInput(page).setInputFiles(sampleFile("PART-002-long-steel-shaft.glb", "gearbox-cover.glb"));
  await expect(header(page).getByLabel("Part name")).toHaveValue("Gearbox cover");
  await setQuantity(page, 200);
  await header(page).getByLabel(/Mass of one part in/).fill("230.5");
  await header(page).getByLabel(/Mass of one part in/).press("Enter");

  const span = header(page).locator(".changenote").locator("> span");
  await expect(span).toContainText("Crate");
  const [box, line] = await Promise.all([span.boundingBox(), span.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))]);
  expect(box!.height, "one line").toBeLessThanOrEqual(line + 2);
  const left = (await island(page).boundingBox())!.x;
  expect(box!.x + box!.width, "stops short of the island").toBeLessThanOrEqual(left);
  await shot(page, "27-header-qty-200");
});

for (const units of ["imperial", "metric"] as const) {
  test(`the cut list's Qty column is fully visible in ${units}`, async ({ page }) => {
    await setUnits(page, units);
    await openTab(page, "Cut list");
    const gap = await page.evaluate(() => {
      const p = document.querySelector('[role="tabpanel"]') as HTMLElement;
      const pr = p.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(p).paddingRight);
      const cells = [...p.querySelectorAll(".cut td:last-child, .cut th:last-child")].filter((c) => (c as HTMLElement).offsetWidth > 0);
      const right = Math.max(...cells.map((c) => c.getBoundingClientRect().right));
      return { room: pr.right - pad - right, overflow: p.scrollWidth - p.clientWidth, cells: cells.length };
    });
    expect(gap.cells).toBeGreaterThan(5);
    // Nothing pokes into the panel's right padding, and the panel doesn't scroll sideways.
    expect(gap.room, "Qty ends inside the panel's padding").toBeGreaterThanOrEqual(-0.5);
    expect(gap.overflow).toBeLessThanOrEqual(0);
    await shot(page, `27-cut-list-${units}`);
  });
}

test('"4x4" keeps a plain x while real sizes keep the × character', async ({ page }) => {
  await setUnits(page, "imperial");
  await openTab(page, "Cut list");
  const skid = panel(page).locator(".cut .row", { hasText: "Skid" }).locator("td.nominal");
  await expect(skid).toHaveText("4x4");
  await expect(skid).toHaveCSS("font-feature-settings", '"calt" 0');
  // Cuts and sizes use ×.
  await expect(panel(page).locator(".cut .row", { hasText: "Floor" })).toContainText("11/16″ × 25");
  await openTab(page, "Overview");
  const base = panel(page).locator("span.nominal", { hasText: "4x4" }).first();
  await expect(base).toHaveCSS("font-feature-settings", '"calt" 0');
  await expect(panel(page)).toContainText("36.7 × 25.7 × 19.6");
  await shot(page, "27-nominal-x");
});

test("the fork arrow clears the width label, closed and exploded", async ({ page }) => {
  await setUnits(page, "imperial");
  await expectArrowClearOfWidthLabel(page);
  await shot(page, "27-arrow-label-closed");
  await explode(page);
  await expectArrowClearOfWidthLabel(page);
  await shot(page, "27-arrow-label-exploded");
  await closeView(page);
});
