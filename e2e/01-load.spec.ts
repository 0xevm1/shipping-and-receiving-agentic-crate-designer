import { expect, test } from "@playwright/test";
import { crate, island, openApp, panel, setUnits, shot, tab } from "./helpers";

test("loads PART-001 × 4 with a rendered crate", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");

  const header = page.getByRole("banner");
  await expect(header).toContainText("PART-001 · Machined steel bracket");
  await expect(header).toContainText(/4140 steel · 21.5 kg each · crate gross \d+ kg/);
  await expect(header).toContainText("model matches catalog");
  await expect(island(page).getByRole("heading", { name: "Machined steel bracket", exact: true })).toBeVisible();
  await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
  await expect(panel(page)).toContainText("Crate for 4 × machined steel bracket");
  await expect(panel(page)).toContainText("932 × 652 × 497");

  const s = await crate(page);
  expect(s).toMatchObject({ partId: "PART-001", quantity: 4, outside: [932, 652, 497], mode: "closed", problem: null });
  expect(s.cameraDistance).toBeGreaterThan(0);

  // WebGL works headless: the scene draws on a real share of the (transparent) canvas.
  const coverage = await page.evaluate(() => window.__crate!.canvasCoverage());
  expect(coverage).toBeGreaterThan(0.05);
  await shot(page, "01-default-closed");
});
