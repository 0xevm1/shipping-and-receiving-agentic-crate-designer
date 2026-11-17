import { expect, test } from "@playwright/test";
import { crate, header, island, mmText, openApp, openTab, panel, setUnits, shot, tab } from "./helpers";

test("opens PART-001 at its recommended quantity with a rendered crate", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");

  await expect(header(page)).toContainText("PART-001 · Machined steel bracket");
  await expect(header(page)).toContainText(/4140 steel · [\d.]+ kg each · crate gross [\d,]+ kg/);
  await expect(header(page)).toContainText("model matches catalog");
  await expect(island(page).getByRole("heading", { name: "Machined steel bracket", exact: true })).toBeVisible();
  await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");

  // The numbers are the domain's (its unit tests pin them); the screen shows what the store holds.
  // With nothing to restore, the preloaded part opens at the sweep's recommendation (spec §7.16).
  const s = await crate(page);
  expect(s).toMatchObject({ partId: "PART-001", quantity: s.recommended, mode: "closed", problem: null });
  expect(s.recommended).toBeGreaterThan(0);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(`Crate for ${s.quantity} × Machined steel bracket`);
  expect(s.outside).toHaveLength(3);
  expect(s.cameraDistance).toBeGreaterThan(0);
  await expect(panel(page)).toContainText(mmText(s.outside!));

  // WebGL works headless: the scene draws on a real share of the (transparent) canvas.
  const coverage = await page.evaluate(() => window.__crate!.canvasCoverage());
  expect(coverage).toBeGreaterThan(0.05);
  await shot(page, "first-load");

  // Rules says the recommendation is the crate on screen.
  await openTab(page, "Rules");
  await expect(panel(page).getByTestId("best-quantity")).toContainText(`Best: ${s.quantity} per crate`);
  await expect(panel(page).getByTestId("best-quantity").getByRole("button", { name: "In use" })).toBeDisabled();
});
