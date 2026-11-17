import { expect, test } from "@playwright/test";
import { crate, cutRows, openApp, openTab, panel, pinnedRow, pollCrate, qtyColumnFit, setUnits, shot } from "./helpers";

test("hovering a row lights it, clicking pins it, Escape clears it", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");

  // Each row holds a real toggle button (focusable, aria-pressed); the row click is the mouse shortcut.
  const row = cutRows(page).first();
  const toggle = row.getByRole("button");
  const label = (await row.getByTestId("cut-piece").innerText()).trim();
  const qty = (await row.getByTestId("cut-qty").innerText()).trim();

  await row.hover();
  await pollCrate(page, (s) => s.hoverKey).not.toBeNull();
  const { hoverKey } = await crate(page);
  await shot(page, "cut-list-hover");

  await row.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.pin).toBe(hoverKey);
  const pinBar = page.getByText(`Showing ${qty} × ${label.toLowerCase()}`);
  await expect(pinBar).toBeVisible();
  await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible();
  await expect(pinnedRow(page)).toHaveCount(1);
  await shot(page, "cut-list-pinned");

  await page.keyboard.press("Escape");
  await pollCrate(page, (s) => s.pin).toBeNull();
  await expect(pinBar).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("a row is a real toggle button: Space pins it, Enter lets go, and the pin follows", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");
  const row = cutRows(page).first();
  const toggle = row.getByRole("button");
  // The state lives on the button, not on the row.
  await expect(row).not.toHaveAttribute("aria-pressed", /.*/);
  await toggle.focus();
  await pollCrate(page, (s) => s.hoverKey).not.toBeNull();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.pin).not.toBeNull();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await pollCrate(page, (s) => s.pin).toBeNull();
});

for (const units of ["imperial", "metric"] as const) {
  test(`the Qty column is fully visible in ${units}`, async ({ page }) => {
    await openApp(page);
    await setUnits(page, units);
    await openTab(page, "Cut list");
    const fit = await qtyColumnFit(page);
    expect(fit.cells).toBeGreaterThan(5);
    // Nothing pokes into the panel's right padding, and the panel doesn't scroll sideways.
    expect(fit.room, "Qty ends inside the panel's padding").toBeGreaterThanOrEqual(-0.5);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    await shot(page, `cut-list-qty-${units}`);
  });
}

// The behaviour under test is the computed style (`font-feature-settings`), which no unit test reaches.
test('"4x4" keeps a plain x while real sizes keep the × character', async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");
  const skid = cutRows(page).filter({ hasText: "Skid" }).first().getByTestId("cut-stock");
  await expect(skid).toHaveText(/^\dx\d$/);
  await expect(skid).toHaveCSS("font-feature-settings", '"calt" 0');
  // Cuts and sizes use ×.
  await expect(cutRows(page).filter({ hasText: "Floor" }).first().getByTestId("cut-size")).toContainText("×");
  await openTab(page, "Overview");
  await expect(
    panel(page)
      .getByText(/^\dx\d$/)
      .first(),
  ).toHaveCSS("font-feature-settings", '"calt" 0');
  await shot(page, "cut-list-nominal-x");
});

test("the piece names stay on one line", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");
  const picks = cutRows(page).getByRole("button");
  const count = await picks.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) expect((await picks.nth(i).boundingBox())!.height, `piece ${i}`).toBeLessThan(24);
  await shot(page, "cut-list-desktop");
});
