import { expect, test } from "@playwright/test";
import {
  burger,
  closeDrawerButton,
  crate,
  drawer,
  expectNoPageScroll,
  fileInput,
  header,
  hidePanelsButton,
  inText,
  mmText,
  massField,
  nameField,
  openApp,
  openDrawer,
  openTab,
  panel,
  sampleFile,
  setUnits,
  SHAFT,
  shot,
  stage,
  summary,
  visibleLabels,
  waitForFrames,
} from "./helpers";

// Phone projects: mobile-390 (390 × 844) and mobile-360 (360 × 800), with touch. The drawer's own
// behaviour is in drawer.mobile.spec.ts; the view bar in view-popover.mobile.spec.ts.

test("the scene fills the screen with the answer on it, and the page doesn't scroll", async ({ page }) => {
  await openApp(page);
  await expectNoPageScroll(page);

  // The canvas is full-bleed and draws.
  const box = (await stage(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box).toMatchObject({ x: 0, y: 0, width: vp.width, height: vp.height });
  expect(await page.evaluate(() => window.__crate!.canvasCoverage())).toBeGreaterThan(0.05);

  // The crate is fully visible: its size labels sit between the header and the foot.
  await waitForFrames(page, 2);
  const head = (await header(page).boundingBox())!;
  const foot = (await summary(page).boundingBox())!;
  const labels = await visibleLabels(page);
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) {
    expect(l.left).toBeGreaterThanOrEqual(0);
    expect(l.right).toBeLessThanOrEqual(vp.width);
    expect(l.top).toBeGreaterThanOrEqual(head.y + head.height - 1);
    expect(l.bottom).toBeLessThanOrEqual(foot.y + 1);
  }

  // The answer without opening anything: outside size and gross weight.
  const { outside } = await crate(page);
  await expect(summary(page)).toBeVisible();
  await expect(summary(page)).toContainText(`${inText(outside!)} in`); // imperial by default
  await expect(summary(page)).toContainText(/Gross\s*\d+ lb/);
  await setUnits(page, "metric");
  await expect(summary(page)).toContainText(`${mmText(outside!)} mm`);
  await expect(summary(page)).toContainText(/Gross\s*\d+ kg/);

  // The island is a closed drawer; Hide panels is desktop-only.
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(burger(page)).toHaveAttribute("aria-controls", "island");
  await expect(hidePanelsButton(page)).toBeHidden();
  await shot(page, "layout-closed-summary");
});

test("the summary chip is the width of the foot, with a gap between size and weight, at any quantity", async ({ page }) => {
  await openApp(page);
  const measure = () =>
    summary(page).evaluate((el) => {
      const foot = el.parentElement!.getBoundingClientRect();
      const [size, weight] = [...el.children].map((v) => v.getBoundingClientRect());
      return { chip: Math.round(el.getBoundingClientRect().width), foot: Math.round(foot.width), gap: weight.left - size.right };
    });
  const before = await measure();
  expect(before.chip).toBe(before.foot);
  expect(before.gap).toBeGreaterThanOrEqual(8);

  await openDrawer(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("200");
  await closeDrawerButton(page).tap();
  await expect(summary(page)).toContainText("crates");
  const after = await measure();
  expect(after.chip).toBe(before.chip);
  expect(after.gap).toBeGreaterThanOrEqual(8);
  await shot(page, "layout-summary-chip");
});

test('the header keeps "crate gross" together on one line, and a change note on one line', async ({ page }) => {
  await openApp(page);
  const gross = header(page).getByTestId("crate-gross");
  await expect(gross).toBeVisible();
  const tops = await gross.evaluate((el) => [...new Set([...el.getClientRects()].map((r) => Math.round(r.top)))]);
  expect(tops, "the gross group is not split across lines").toHaveLength(1);
  await shot(page, "layout-header");

  // A custom part at quantity 200 with a mass edit: the note is one truncated line.
  await openDrawer(page);
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "gearbox-cover.glb"));
  await expect(nameField(page)).toHaveValue("Gearbox cover");
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("200");
  await panel(page).getByLabel("Quantity").blur();
  await closeDrawerButton(page).tap();
  await expect(drawer(page)).toBeHidden();
  await massField(page).fill("230.5");
  await massField(page).press("Enter");
  const span = header(page).getByTestId("change-note").locator(":scope > span");
  await expect(span).toContainText("Crate");
  const [box, line] = await Promise.all([span.boundingBox(), span.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))]);
  expect(box!.height, "one line").toBeLessThanOrEqual(line + 2);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await shot(page, "layout-header-qty-200");
});

test("the controls inside the panels are at least 44 px", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await openTab(page, "Rules");
  const small = await page.evaluate(() => {
    const p = document.querySelector('[role="tabpanel"]')!;
    // The switch (a checkbox) is checked below: its hit area is a pseudo-element around it.
    const sel = 'button, input:not([type="file"]):not([type="checkbox"]), select, summary';
    return [...p.querySelectorAll<HTMLElement>(sel)]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < 43.5 || r.width < 43.5))
      .map(
        ({ el, r }) =>
          `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""} ${Math.round(r.width)}×${Math.round(r.height)}`,
      );
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
  await shot(page, "layout-rules-touch");

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

test("the Export pill stays under the part lines, at touch size", async ({ page }) => {
  await openApp(page);
  const pill = header(page).getByRole("button", { name: /^Export specs/ });
  const pillBox = (await pill.boundingBox())!;
  const meta = (await header(page).getByTestId("part-meta").boundingBox())!;
  expect(pillBox.height).toBeGreaterThanOrEqual(44);
  expect(pillBox.y).toBeGreaterThan(meta.y + meta.height - 1);
  await shot(page, "layout-export-pill");
});
