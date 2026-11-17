import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, panel, sampleFile, shot } from "./helpers";
import { closeView, explode, expectArrowClearOfWidthLabel } from "./27-layout-helpers";

/** UI review fixes (#62) at phone sizes (mobile-390 and mobile-360), with touch. */

const header = (page: Page) => page.getByRole("banner");
const name = (suffix: string) => `27-${test.info().project.name}-${suffix}`;

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "Crate details" }).tap();
  await expect(page.getByRole("dialog", { name: "Crate details" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('the header keeps "crate gross" together on one line, and the note on one line', async ({ page }) => {
  const gross = header(page).locator(".partmeta .nw", { hasText: "gross" });
  await expect(gross).toBeVisible();
  const tops = await gross.evaluate((el) => [...new Set([...el.getClientRects()].map((r) => Math.round(r.top)))]);
  expect(tops, "the gross group is not split across lines").toHaveLength(1);
  await shot(page, name("header"));

  // A custom part at quantity 200 with a mass edit: the note is one truncated line.
  await openDrawer(page);
  await page.getByRole("dialog", { name: "Crate details" }).locator('input[type="file"]').setInputFiles(sampleFile("PART-002-long-steel-shaft.glb", "gearbox-cover.glb"));
  await expect(header(page).getByLabel("Part name")).toHaveValue("Gearbox cover");
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("200");
  await panel(page).getByLabel("Quantity").blur();
  await page.getByRole("button", { name: "Close the panel" }).tap();
  await expect(page.getByRole("dialog", { name: "Crate details" })).toBeHidden();
  const mass = header(page).getByLabel(/Mass of one part in/);
  await mass.fill("230.5");
  await mass.press("Enter");
  const span = header(page).locator(".changenote").locator("> span");
  await expect(span).toContainText("Crate");
  const [box, line] = await Promise.all([span.boundingBox(), span.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))]);
  expect(box!.height, "one line").toBeLessThanOrEqual(line + 2);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await shot(page, name("header-qty-200"));
});

test("the controls inside the panels are at least 44 px", async ({ page }) => {
  await openDrawer(page);
  await openTab(page, "Rules");
  const small = await page.evaluate(() => {
    const p = document.querySelector('[role="tabpanel"]')!;
    // The switch (a checkbox) is checked below: its hit area is a pseudo-element around it.
    const sel = 'button, input:not([type="file"]):not([type="checkbox"]), select, summary';
    return [...p.querySelectorAll<HTMLElement>(sel)]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < 43.5 || r.width < 43.5))
      .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""} ${Math.round(r.width)}×${Math.round(r.height)}`);
  });
  expect(small, "controls under 44 px").toEqual([]);
  // Taps 21 px above and below the switch's centre still land on it (a 44 px hit area).
  const sw = (await panel(page).getByLabel("Keep parts upright").boundingBox())!;
  for (const dy of [-21, 21]) {
    const hit = await page.evaluate(
      ([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.getAttribute("aria-label"),
      [sw.x + sw.width / 2, sw.y + sw.height / 2 + dy],
    );
    expect(hit).toBe("Keep parts upright");
  }
  await shot(page, name("rules-touch"));

  // The other tabs' buttons and inputs too.
  for (const t of ["Overview", "Layouts", "Cut list", "Checks"]) {
    await openTab(page, t);
    const under = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[role="tabpanel"] button, [role="tabpanel"] input:not([type="file"]), [role="tabpanel"] select')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height < 43.5)
        .map(({ el, r }) => `${el.tagName.toLowerCase()} ${el.textContent?.slice(0, 20)} ${Math.round(r.height)}`),
    );
    expect(under, `${t}: controls under 44 px tall`).toEqual([]);
  }
});

test("the cut list's Qty column is fully visible in imperial", async ({ page }) => {
  // The app opens in imperial (#15).
  await openDrawer(page);
  await openTab(page, "Cut list");
  const gap = await page.evaluate(() => {
    const p = document.querySelector('[role="tabpanel"]') as HTMLElement;
    const pr = p.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(p).paddingRight);
    const cells = [...p.querySelectorAll(".cut td:last-child, .cut th:last-child")].filter((c) => (c as HTMLElement).offsetWidth > 0);
    const right = Math.max(...cells.map((c) => c.getBoundingClientRect().right));
    return { room: pr.right - pad - right, overflow: p.scrollWidth - p.clientWidth };
  });
  expect(gap.room).toBeGreaterThanOrEqual(-0.5);
  expect(gap.overflow).toBeLessThanOrEqual(0);
  await shot(page, name("cut-list-imperial"));
});

test("the fork arrow clears the width label, closed and exploded", async ({ page }) => {
  await expectArrowClearOfWidthLabel(page);
  await shot(page, name("arrow-label-closed"));
  await explode(page);
  await expectArrowClearOfWidthLabel(page);
  await shot(page, name("arrow-label-exploded"));
  await closeView(page);
});
