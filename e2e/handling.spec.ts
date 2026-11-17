import { expect, test, type Page } from "@playwright/test";
import {
  checks,
  crate,
  disableShapeAnalysis,
  explode,
  modeButton,
  openApp,
  openPrintTab,
  openTab,
  openViewPopover,
  panel,
  pollCrate,
  setQuantity,
  setStandard,
  setUnits,
  sheet,
  shot,
  stubPrint,
  tab,
  viewButton,
} from "./helpers";

/**
 * Centre of gravity, forklift and pallet-jack handling: the checks, the 3D marks (CoG stencils on the outside
 * faces only when the CoG check is a caution; fork-entry arrows at both ends) that go with the size labels,
 * and the CoG mark on the shipping label. The distances, thresholds and wording are the domain's and are
 * unit-tested (`handling.test.ts`); this proves they reach the Checks tab, the 3D view and the print.
 *
 * The CoG relations are checked on bounding-box blocking (shape analysis off), where the symmetric 2 × 2
 * bracket load sits exactly on both centre lines. Shaped blocking then adds a block in each bracket's shallow
 * recess and none on its open side, which really does move the CoG; that case is checked on its own.
 */

test.beforeEach(async ({ context }) => {
  await stubPrint(context);
});

/** The crate's inside length and width in mm, from the Overview's "Inside is L × W × H mm" (the CoG is in the same frame). */
async function interiorMm(page: Page) {
  await setUnits(page, "metric");
  await openTab(page, "Overview");
  const m = /Inside is (\d+) × (\d+) × (\d+) mm/.exec((await panel(page).textContent()) ?? "")!;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test.describe("bounding-box blocking", () => {
  test.beforeEach(async ({ page }) => {
    await disableShapeAnalysis(page);
    await openApp(page);
  });

  test("Checks lists the centre of gravity and the forklift and pallet-jack checks", async ({ page }) => {
    // The pallet jack is a pass (use a forklift) on the default crate, so there is still no badge.
    await expect(tab(page, "Checks")).toHaveText("Checks");
    await openTab(page, "Checks");
    const p = panel(page);
    await expect(p).toContainText("Centre of gravity near the middle");
    await expect(p).toContainText("It is on both centre lines");
    await expect(p).toContainText("Low centre of gravity");
    await expect(p).toContainText("Forklift fits from the ends");
    // Imperial by default: shop measurements to the nearest 1/16″, then the same in metric.
    await expect(p).toContainText(/Forklift: fits from the ends, \d+( \d+\/\d+)?″ clear under the floor, needs \d+( \d+\/\d+)?″\./);
    await setUnits(page, "metric");
    await expect(p).toContainText(/Forklift: fits from the ends, \d+ mm clear under the floor, needs \d+ mm\./);
    const jack = checks(page, "ok").filter({ hasText: "Pallet jack won't fit: use a forklift" });
    await expect(jack).toContainText(/The widest gap between the skids is \d+ mm\. A pallet jack needs \d+ mm–\d+ mm across its forks\./);
    await jack.scrollIntoViewIfNeeded();
    await shot(page, "handling-checks-metric");
    await setUnits(page, "imperial");
    await expect(jack).toContainText(
      /The widest gap between the skids is [\d ]+(\/\d+)?″\. A pallet jack needs [\d ]+(\/\d+)?″–[\d ]+(\/\d+)?″ across its forks\./,
    );
    await shot(page, "handling-checks");
  });

  test("the pallet-jack row is a pass in print, and a caution when no forklift fits either", async ({ page }) => {
    const print = await openPrintTab(page);
    const spec = sheet(print, "Crate spec");
    await expect(spec.getByRole("row").filter({ hasText: "Pallet jack won't fit: use a forklift" })).toContainText("Pass");
    await print.setViewportSize({ width: 1000, height: 1400 });
    await shot(spec.getByRole("table"), "handling-print-checks");
    await print.close();

    // One part is too small for a forklift as well, so the jack row stays a caution (not a pass).
    await setQuantity(page, 1);
    await openTab(page, "Checks");
    await expect(checks(page, "caution").filter({ hasText: "Pallet jack may not fit" })).toBeVisible();
    await expect(panel(page)).not.toContainText("use a forklift");
  });

  test("the 3D view marks the centre of gravity and the fork entry, with the size labels", async ({ page }) => {
    const interior = await interiorMm(page);
    const s = await crate(page);
    expect(s.cog).not.toBeNull();
    // Symmetric 2 × 2 load: on both centre lines of the interior.
    expect(s.cog!.mm[0]).toBeCloseTo(interior[0] / 2, 0);
    expect(s.cog!.mm[1]).toBeCloseTo(interior[1] / 2, 0);
    // A centred, low CoG gets no marker in 3D; the label and Checks still give it.
    await pollCrate(page, (c) => c.cog?.marker).toBeNull();
    // One opening between the two skids, an arrow at each end.
    await pollCrate(page, (c) => c.cog?.arrows).toBe(2);

    // Parts off, so their size labels don't sit over the CoG mark in the screenshots.
    const parts = await openViewPopover(page);
    await parts.getByLabel("Parts", { exact: true }).uncheck();
    await viewButton(page).click();
    await expect(parts).toBeHidden();

    // Exploded: the marks stay and the arrows slide out with the end walls.
    await explode(page);
    await pollCrate(page, (c) => c.cog?.arrows).toBe(2);
    await shot(page, "handling-3d-exploded");
    await modeButton(page).click();
    await pollCrate(page, (c) => c.mode).toBe("closed");
    await shot(page, "handling-3d");

    const pop = await openViewPopover(page);
    await pop.getByLabel("Size labels", { exact: true }).uncheck();
    await pollCrate(page, (c) => c.cog?.arrows).toBe(0);
    // The design still has its CoG; only the marks are hidden.
    expect((await crate(page)).cog!.mm).toEqual(s.cog!.mm);
    await pop.getByLabel("Size labels", { exact: true }).check();
    await pollCrate(page, (c) => c.cog?.arrows).toBe(2);
  });
});

test.describe("with shaped blocking", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("shaped blocking moves the CoG toward the bracket's blocked side, and Checks says so", async ({ page }) => {
    await pollCrate(page, (c) => c.shapedBlocking).toBe(true);
    const interior = await interiorMm(page);
    const s = await crate(page);
    // Blocks fill each bracket's shallow recess only: the CoG moves toward -X (the left end).
    expect(s.cog!.mm[0]).toBeLessThan(interior[0] / 2);
    await openTab(page, "Checks");
    await expect(panel(page)).toContainText(/It is \d+ mm toward the left end/);
    await expect(panel(page)).toContainText("Centre of gravity near the middle");
    await setUnits(page, "imperial");
    await expect(panel(page)).toContainText(/It is [\d ]+(\/\d+)?″ toward the left end/);
  });

  test("the CoG is stencilled on the outside faces only when its check is a caution", async ({ page }) => {
    const s = await crate(page);
    await pollCrate(page, (c) => c.cog?.marker).toBeNull();

    // Make this crate count as top-heavy: its tip angle is about 51°, so an 80° limit is a caution.
    await setStandard(page, "Top-heavy below tip angle", 80);
    await pollCrate(page, (c) => c.cog?.marker).toEqual(s.cog!.mm);
    await openTab(page, /Checks/);
    await expect(panel(page)).toContainText("under the 80° limit");
    await shot(page, "handling-cog-stencil");

    // Back under the limit: the stencils go again.
    await setStandard(page, "Top-heavy below tip angle", 30);
    await pollCrate(page, (c) => c.cog?.marker).toBeNull();
  });

  test("the shipping label marks the centre of gravity between the fork arrows", async ({ page }) => {
    const print = await openPrintTab(page);
    const label = sheet(print, "Shipping label");
    await expect(label).toContainText("FORK ENTRY FROM THE ENDS");
    await expect(label).toContainText("FORKS");
    const mark = label.getByLabel("Centre of gravity");
    await expect(mark).toBeVisible();
    await expect(mark).toContainText("CENTRE OF GRAVITY");
    // The mark sits mid-width on the end view: its circle is centred on the crate end.
    const end = label.getByRole("img", { name: "Crate end with fork entry marks" });
    const [endBox, circle] = await Promise.all([end.locator("rect").first().boundingBox(), mark.locator("circle").boundingBox()]);
    expect(Math.abs(circle!.x + circle!.width / 2 - (endBox!.x + endBox!.width / 2))).toBeLessThan(2);
    await shot(label, "handling-label");
  });
});
