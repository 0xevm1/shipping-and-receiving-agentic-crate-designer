import { expect, test } from "@playwright/test";
import { cutRows, openApp, openDrawer, openTab, panel, qtyColumnFit, shot } from "./helpers";

// Phone projects. On a phone the cut list stacks each row instead of scrolling sideways, and keeps Cut and Qty visible.

test("the cut list shows every column inside the drawer, with no sideways scroll", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await openTab(page, "Cut list");
  const p = panel(page);
  await expect(cutRows(page).first()).toBeVisible();

  expect(await p.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const box = (await p.boundingBox())!;
  const rows = cutRows(page);
  for (let i = 0; i < Math.min(await rows.count(), 6); i++) {
    const row = rows.nth(i);
    const [piece, stock, cut, qty] = await Promise.all(
      ["cut-piece", "cut-stock", "cut-size", "cut-qty"].map(async (id) => (await row.getByTestId(id).boundingBox())!),
    );
    for (const [name, cell] of [
      ["cut", cut],
      ["qty", qty],
    ] as const) {
      expect(cell.x, `row ${i} ${name} left`).toBeGreaterThanOrEqual(box.x);
      expect(cell.x + cell.width, `row ${i} ${name} right`).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
    // Piece and stock share the first line; cut and quantity the second.
    expect(Math.abs(piece.y - stock.y)).toBeLessThan(20);
    expect(Math.abs(cut.y - qty.y)).toBeLessThan(20);
    expect(cut.y).toBeGreaterThan(piece.y);
  }
  // Touch wording, not mouse wording.
  await expect(p.getByTestId("hint-touch")).toBeVisible();
  await expect(p.getByTestId("hint-mouse")).toBeHidden();
  await shot(page, "cut-list-mobile");
});

test("the Qty column is fully visible in imperial", async ({ page }) => {
  await openApp(page); // the app opens in imperial
  await openDrawer(page);
  await openTab(page, "Cut list");
  const fit = await qtyColumnFit(page);
  expect(fit.room).toBeGreaterThanOrEqual(-0.5);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  await shot(page, "cut-list-mobile-qty-imperial");
});
