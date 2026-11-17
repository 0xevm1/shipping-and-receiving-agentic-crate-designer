import { expect, test } from "@playwright/test";
import { crate, openApp, openTab, panel, pollCrate, shot } from "./helpers";

test("hovering a row lights it, clicking pins it, Escape clears it", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");

  // Cut-list rows are toggle buttons in all but tag (focusable, aria-pressed).
  const row = panel(page).locator("tr[aria-pressed]").first();
  const label = (await row.getByRole("cell").first().innerText()).trim();
  const qty = (await row.getByRole("cell").last().innerText()).trim();

  await row.hover();
  await pollCrate(page, (s) => s.hoverKey).not.toBeNull();
  const { hoverKey } = await crate(page);
  await shot(page, "05-cutlist-hover");

  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.pin).toBe(hoverKey);
  const pinBar = page.getByText(`Showing ${qty} × ${label.toLowerCase()}`);
  await expect(pinBar).toBeVisible();
  await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible();
  await shot(page, "05-cutlist-pinned");

  await page.keyboard.press("Escape");
  await pollCrate(page, (s) => s.pin).toBeNull();
  await expect(pinBar).toBeHidden();
  await expect(row).toHaveAttribute("aria-pressed", "false");
});
