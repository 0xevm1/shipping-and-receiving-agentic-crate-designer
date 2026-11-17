import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, openTab, panel, pollCrate, shot } from "./helpers";

/** Sets the batch size in Rules and waits for the store to take it. */
async function setQuantity(page: Page, quantity: number) {
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill(String(quantity));
  await pollCrate(page, (s) => s.quantity).toBe(quantity);
}

const picker = (page: Page) => panel(page).getByRole("group", { name: "Crate type on screen" });
const standards = (page: Page) => panel(page).locator("details", { hasText: "Shop standards" });

/** The first cut-list row's quantity for a piece, e.g. "Skid". */
const rowQty = async (page: Page, piece: string) => {
  const row = panel(page).locator("table.cut tbody tr", { has: page.getByRole("cell", { name: piece, exact: true }) }).first();
  return Number(await row.locator("td").last().textContent());
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("the sample quantities still ship as one crate", async ({ page }) => {
  await setQuantity(page, 8);
  const s = await crate(page);
  expect(s.crateTypes).toEqual([{ label: "A", count: 1, quantity: 8 }]);
  await openTab(page, "Overview");
  await expect(panel(page).getByRole("region", { name: "Shipment" })).toHaveCount(0);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Crate for 8 × machined steel bracket");
});

test("200 brackets split into crates within the 1,000 kg limit, and switching crate type follows through", async ({ page }) => {
  await setQuantity(page, 200);
  const s = await crate(page);
  expect(s.crateTypes.length).toBe(2);
  expect(s.crateTypes.reduce((n, c) => n + c.count * c.quantity, 0)).toBe(200);
  const [a, b] = s.crateTypes;
  expect(s.crateIndex).toBe(0);
  expect(s.crateParts).toBe(a.quantity);

  await openTab(page, "Overview");
  const summary = panel(page).getByRole("region", { name: "Shipment" });
  await expect(summary).toContainText(`Ships as ${a.count} × crate A (${a.quantity} each) + 1 × crate B (${b.quantity})`);
  await expect(summary).toContainText("200 parts");
  await expect(panel(page).getByRole("heading", { level: 2 })).toContainText(`Crate A: ${a.quantity} × machined steel bracket`);
  // Every crate type passes the base rating and the per-crate limit.
  await shot(page, "12-split-overview-a");

  const outsideA = s.outside;
  await picker(page).getByRole("button", { name: /^Crate B/ }).click();
  await pollCrate(page, (x) => x.crateIndex).toBe(1);
  const sb = await crate(page);
  expect(sb.crateParts).toBe(b.quantity);
  expect(sb.outside).not.toEqual(outsideA);
  await expect(panel(page).getByRole("heading", { level: 2 })).toContainText(`Crate B: ${b.quantity} × machined steel bracket`);
  await shot(page, "12-split-overview-b");

  // The Checks follow the crate on screen and include the per-crate limit.
  await openTab(page, "Checks");
  await expect(panel(page)).toContainText("Within the per-crate limits");
  await expect(panel(page)).toContainText("Within the standard base rating");

  // The cut list follows it too, and can show the whole shipment.
  await openTab(page, "Cut list");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cut list for crate B");
  const blocksB = await rowQty(page, "Blocking post");
  await picker(page).getByRole("button", { name: /^Crate A/ }).click();
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cut list for crate A");
  await expect.poll(() => rowQty(page, "Blocking post")).not.toBe(blocksB);
  const skidsA = await rowQty(page, "Skid");
  await shot(page, "12-split-cutlist-crate");

  await panel(page).getByRole("button", { name: "Whole shipment" }).click();
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cut list for the whole shipment");
  await expect(panel(page)).toContainText(`Quantities are for all ${a.count + 1} crates`);
  expect(await rowQty(page, "Skid")).toBeGreaterThanOrEqual(skidsA * a.count);
  await shot(page, "12-split-cutlist-shipment");
});

test("a lower max gross per crate in Shop standards changes the split", async ({ page }) => {
  await setQuantity(page, 200);
  const before = (await crate(page)).crateTypes.reduce((n, c) => n + c.count, 0);

  await standards(page).getByText("Shop standards", { exact: true }).click();
  const field = standards(page).getByLabel("Max gross per crate");
  await expect(field).toHaveValue("1000");
  await field.fill("500");
  await field.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect.poll(async () => (await crate(page)).crateTypes.reduce((n, c) => n + c.count, 0)).toBeGreaterThan(before);
  await shot(page, "12-split-standards-500kg");

  const after = (await crate(page)).crateTypes;
  await openTab(page, "Overview");
  const total = after.reduce((n, c) => n + c.count, 0);
  await expect(panel(page).getByRole("region", { name: "Shipment" })).toContainText(`Shipment · ${total} crates`);
  await shot(page, "12-split-overview-500kg");

  await openTab(page, "Rules");
  await standards(page).getByText("Shop standards", { exact: true }).click();
  await standards(page).getByRole("button", { name: "Reset to defaults" }).click();
  await expect.poll(async () => (await crate(page)).crateTypes.reduce((n, c) => n + c.count, 0)).toBe(before);
});
