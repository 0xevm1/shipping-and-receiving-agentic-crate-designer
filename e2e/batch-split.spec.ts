import { expect, test, type Page } from "@playwright/test";
import { crate, cutQty, cutRow, openApp, openStandards, openTab, panel, pollCrate, setQuantity, shot, standards } from "./helpers";

/** A batch split across crates: the shipment block, the crate type picker, and what follows the crate on screen. */

const picker = (page: Page) => panel(page).getByRole("group", { name: "Crate type on screen" });
const shipment = (page: Page) => panel(page).getByRole("region", { name: "Shipment" });
const crateCount = async (page: Page) => (await crate(page)).crateTypes.reduce((n, c) => n + c.count, 0);

/** The first cut-list row's quantity for a piece, e.g. "Skid". */
const rowQty = async (page: Page, piece: string) => Number(await cutQty(cutRow(page, piece)).textContent());

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("the sample quantities still ship as one crate", async ({ page }) => {
  await setQuantity(page, 8);
  expect((await crate(page)).crateTypes).toEqual([{ label: "A", count: 1, quantity: 8 }]);
  await openTab(page, "Overview");
  await expect(shipment(page)).toHaveCount(0);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Crate for 8 × Machined steel bracket");
});

test("200 brackets split into crates, and switching crate type follows through", async ({ page }) => {
  await setQuantity(page, 200);
  const s = await crate(page);
  // More than one crate type, and every part is in some crate.
  expect(s.crateTypes.length).toBeGreaterThan(1);
  expect(s.crateTypes.reduce((n, c) => n + c.count * c.quantity, 0)).toBe(200);
  const [a, b] = s.crateTypes;
  expect(s.crateIndex).toBe(0);
  expect(s.crateParts).toBe(a.quantity);

  await openTab(page, "Overview");
  await expect(shipment(page)).toContainText(`Ships as ${a.count} × crate A (${a.quantity} each) + ${b.count} × crate B (${b.quantity})`);
  await expect(shipment(page)).toContainText("200 parts");
  await expect(panel(page).getByRole("heading", { level: 2 })).toContainText(`Crate A: ${a.quantity} × Machined steel bracket`);
  await shot(page, "batch-split-overview-a");

  const outsideA = s.outside;
  await picker(page)
    .getByRole("button", { name: /^Crate B/ })
    .click();
  await pollCrate(page, (x) => x.crateIndex).toBe(1);
  const sb = await crate(page);
  expect(sb.crateParts).toBe(b.quantity);
  expect(sb.outside).not.toEqual(outsideA);
  await expect(panel(page).getByRole("heading", { level: 2 })).toContainText(`Crate B: ${b.quantity} × Machined steel bracket`);
  await shot(page, "batch-split-overview-b");

  // The Checks follow the crate on screen and include the per-crate limit.
  await openTab(page, "Checks");
  await expect(panel(page)).toContainText("Within the per-crate limits");
  await expect(panel(page)).toContainText("Within the base rating");

  // The cut list follows it too, and can show the whole shipment.
  await openTab(page, "Cut list");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cut list for crate B");
  const blocksB = await rowQty(page, "Blocking post");
  await picker(page)
    .getByRole("button", { name: /^Crate A/ })
    .click();
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cut list for crate A");
  await expect.poll(() => rowQty(page, "Blocking post")).not.toBe(blocksB);
  const skidsA = await rowQty(page, "Skid");
  await shot(page, "batch-split-cut-list-crate");

  await panel(page).getByRole("button", { name: "Whole shipment" }).click();
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cut list for the whole shipment");
  await expect(panel(page)).toContainText(`Quantities are for all ${a.count + b.count} crates`);
  expect(await rowQty(page, "Skid")).toBeGreaterThanOrEqual(skidsA * a.count);
  await shot(page, "batch-split-cut-list-shipment");
});

test("a lower max gross per crate in Shop standards changes the split", async ({ page }) => {
  await setQuantity(page, 200);
  const before = await crateCount(page);

  await openStandards(page);
  const field = standards(page).getByLabel("Max gross per crate");
  const defaultMax = Number(await field.inputValue());
  await field.fill(String(defaultMax / 2));
  await field.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect.poll(() => crateCount(page)).toBeGreaterThan(before);
  await shot(page, "batch-split-standards-lower-max");

  const total = await crateCount(page);
  await openTab(page, "Overview");
  await expect(shipment(page)).toContainText(`Shipment · ${total} crates`);
  await shot(page, "batch-split-overview-lower-max");

  await openStandards(page);
  await standards(page).getByRole("button", { name: "Reset to defaults" }).click();
  await expect.poll(() => crateCount(page)).toBe(before);
});

test("a split shipment shows its total cost and labour in the Shipment block, with grouped weights", async ({ page }) => {
  await setQuantity(page, 200);
  await openTab(page, "Overview");
  await expect(shipment(page)).toContainText(/\$[\d,]+ to build/);
  await expect(shipment(page)).toContainText(/\d+ h \d+ m of labour/);
  await expect(shipment(page)).toContainText(/gross [\d,]+ lb/);
  // Imperial by default: no four-digit weight is left ungrouped ("1,234", not "1234").
  await expect(shipment(page).getByText(/\b\d{4,} lb/)).toHaveCount(0);
  await expect(panel(page).getByRole("region", { name: "Scorecard" })).not.toContainText("Whole shipment");
  await shot(page, "batch-split-shipment-block");
});

test("layout cards keep each unit on its number", async ({ page }) => {
  await setQuantity(page, 200);
  await openTab(page, "Layouts");
  const deltas = panel(page).getByTestId("layout-delta").locator(":scope > span");
  const count = await deltas.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = (await deltas.nth(i).boundingBox())!;
    expect(box.height, `delta part ${i} on one line`).toBeLessThan(22);
  }
  await shot(page, "batch-split-layout-card");
});
