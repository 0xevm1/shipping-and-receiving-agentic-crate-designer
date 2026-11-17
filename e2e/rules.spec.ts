import { expect, test, type Page } from "@playwright/test";
import { crate, mmText, openApp, openTab, panel, pollCrate, setQuantity, setUnits, shot } from "./helpers";

const plywood = (page: Page, name: string) => panel(page).getByRole("group", { name: "Wall and lid plywood" }).getByRole("button", { name, exact: true });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
  await openTab(page, "Rules");
});

test("quantity 8 resizes the crate", async ({ page }) => {
  // From 4 (the app opens at the recommendation, a larger batch).
  await setQuantity(page, 4);
  const before = (await crate(page)).outside!;
  await setQuantity(page, 8);
  await pollCrate(page, (s) => s.outside).not.toEqual(before);
  const after = (await crate(page)).outside!;
  // More parts stack higher: the crate grows, and the Overview shows the new size.
  expect(after[2]).toBeGreaterThan(before[2]);
  await openTab(page, "Overview");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Crate for 8 × Machined steel bracket");
  await expect(panel(page)).toContainText(mmText(after));
  await shot(page, "rules-quantity-8");
});

test("a typed quantity over 200 is clamped to 200, and the note points to Parts to ship", async ({ page }) => {
  const qty = panel(page).getByLabel("Quantity");
  await qty.fill("500");
  await pollCrate(page, (s) => s.quantity).toBe(200);
  // One crate holds at most 200: the note says so and where to ship more (#111). It stays until the next edit.
  const note = panel(page).getByTestId("quantity-cap-note");
  await expect(note).toContainText("One crate holds at most 200. To ship 500, use Parts to ship on the Overview");
  await shot(page, "rules-clamp-note");
  await qty.blur();
  await expect(qty).toHaveValue("200");
  await expect(note).toContainText("One crate holds at most 200");
  // The next edit clears it.
  await panel(page).getByRole("button", { name: "One fewer" }).click();
  await expect(note).toBeEmpty();
});

test("Reset rules restores the defaults but keeps the quantity", async ({ page }) => {
  await setQuantity(page, 8);
  const defaults = (await crate(page)).outside;
  await panel(page).getByRole("group", { name: "Most layers allowed" }).getByRole("button", { name: "1", exact: true }).click();
  await plywood(page, "19").click();
  await expect(plywood(page, "19")).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.outside).not.toEqual(defaults);

  await panel(page).getByRole("button", { name: "Reset rules" }).click();
  await expect(panel(page).getByLabel("Quantity")).toHaveValue("8");
  await expect(plywood(page, "Auto")).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.outside).toEqual(defaults);
  await shot(page, "rules-reset");
});

test("the suggested quantities are their own labelled group, apart from the stepper, and set the quantity", async ({ page }) => {
  const presets = panel(page).getByRole("group", { name: "Suggested quantities" });
  await expect(presets).toBeVisible();
  const stepper = panel(page).getByLabel("Quantity");
  // Not inside the stepper's capsule: they sit below it.
  const s = (await stepper.boundingBox())!;
  const p = (await presets.boundingBox())!;
  expect(p.y).toBeGreaterThan(s.y + s.height - 1);
  const eight = presets.getByRole("button", { name: "8", exact: true });
  await eight.click();
  await pollCrate(page, (st) => st.quantity).toBe(8);
  await expect(eight).toHaveAttribute("aria-pressed", "true");
  await expect(stepper).toHaveValue("8");
  await shot(page, "rules-presets");
});
