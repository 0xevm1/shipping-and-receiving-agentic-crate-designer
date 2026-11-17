import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, panel, pollCrate, shot } from "./helpers";

const QTY_8_OUTSIDE = [938, 658, 823];

const plywood = (page: Page, name: string) =>
  panel(page).getByRole("group", { name: "Wall and lid plywood" }).getByRole("button", { name, exact: true });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openTab(page, "Rules");
});

test("quantity 8 resizes the crate", async ({ page }) => {
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.outside).toEqual(QTY_8_OUTSIDE);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("Crate for 8 × machined steel bracket");
  await expect(panel(page)).toContainText("938 × 658 × 823");
  await shot(page, "03-rules-quantity-8");
});

test("a typed quantity over 200 is clamped to 200", async ({ page }) => {
  const qty = panel(page).getByLabel("Quantity");
  await qty.fill("500");
  await pollCrate(page, (s) => s.quantity).toBe(200);
  // #36: a polite note by the field says what happened.
  await expect(panel(page).getByRole("status").filter({ hasText: "Quantity is 1–200; set to 200" })).toBeVisible();
  await shot(page, "03-rules-clamp-note");
  await qty.blur();
  await expect(qty).toHaveValue("200");
});

test("Reset rules restores the defaults but keeps the quantity", async ({ page }) => {
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.outside).toEqual(QTY_8_OUTSIDE);
  await panel(page).getByRole("group", { name: "Most layers allowed" }).getByRole("button", { name: "1", exact: true }).click();
  await plywood(page, "19").click();
  await expect(plywood(page, "19")).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.outside).not.toEqual(QTY_8_OUTSIDE);

  await panel(page).getByRole("button", { name: "Reset rules" }).click();
  await expect(panel(page).getByLabel("Quantity")).toHaveValue("8");
  await expect(plywood(page, "Auto")).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.outside).toEqual(QTY_8_OUTSIDE);
  await shot(page, "03-rules-reset");
});
