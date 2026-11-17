import { expect, test } from "@playwright/test";
import { openApp, openTab, panel, shot } from "./helpers";

/** On a phone the cut list stacks each row instead of scrolling sideways, and keeps Cut and Qty visible. */

test("the cut list shows every column inside the drawer, with no sideways scroll", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Crate details" }).tap();
  await openTab(page, "Cut list");
  const p = panel(page);
  await expect(p.locator(".cut .row").first()).toBeVisible();

  expect(await p.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const box = (await p.boundingBox())!;
  const rows = p.locator(".cut .row");
  for (let i = 0; i < Math.min(await rows.count(), 6); i++) {
    for (const col of [3, 4]) {
      const cell = rows.nth(i).locator(`td:nth-child(${col})`);
      const c = (await cell.boundingBox())!;
      expect(c.x, `row ${i} column ${col} left`).toBeGreaterThanOrEqual(box.x);
      expect(c.x + c.width, `row ${i} column ${col} right`).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
    // Piece and stock share the first line; cut and quantity the second.
    const [piece, stock, cut, qty] = await Promise.all([1, 2, 3, 4].map(async (n) => (await rows.nth(i).locator(`td:nth-child(${n})`).boundingBox())!));
    expect(Math.abs(piece.y - stock.y)).toBeLessThan(20);
    expect(Math.abs(cut.y - qty.y)).toBeLessThan(20);
    expect(cut.y).toBeGreaterThan(piece.y);
  }
  // Touch wording, not mouse wording.
  await expect(p.locator(".hint-touch")).toBeVisible();
  await expect(p.locator(".hint-mouse")).toBeHidden();
  await shot(page, "32-cutlist-mobile");
});
