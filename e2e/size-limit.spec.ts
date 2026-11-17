import { expect, test, type Page } from "@playwright/test";
import { checks, crate, openApp, openStandards, openTab, panel, pollCrate, setQuantity, setStandard, setUnits, shot, standards } from "./helpers";

/**
 * The per-crate size limit (#108, spec §6.4 and §7.10): a shop's own limit on one crate's outside size
 * (a pallet position, a door, a height), set in Shop standards. A batch that would be bigger splits into
 * more crates, and a part that is over it on its own is said plainly. The rule, the swap of length and width
 * and the numbers are the domain's and are unit-tested (`crateSizeLimit.test.ts`); this proves the fields
 * reach the plan, the Overview and the Checks tab.
 */

const crateCount = async (page: Page) => (await crate(page)).crateTypes.reduce((n, c) => n + c.count, 0);
const partsShipped = async (page: Page) => (await crate(page)).crateTypes.reduce((n, c) => n + c.count * c.quantity, 0);

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("a size limit in Shop standards splits the batch into crates that fit it", async ({ page }) => {
  // The size of a crate for one part, which is the limit: nothing bigger is allowed.
  await setQuantity(page, 1);
  const [l1, w1, h1] = (await crate(page)).outside!.map(Math.ceil);
  await setQuantity(page, 8);
  expect((await crate(page)).crateTypes).toEqual([{ label: "A", count: 1, quantity: 8 }]);

  await setStandard(page, "Max crate length", l1);
  await setStandard(page, "Max crate width", w1);
  await setStandard(page, "Max crate height", h1);
  await pollCrate(page, (s) => s.crateTypes.reduce((n, c) => n + c.count, 0)).toBeGreaterThan(1);
  await shot(page, "size-limit-standards");

  // Every part still ships, and the crate on screen is within the limit (height never swaps).
  expect(await partsShipped(page)).toBe(8);
  expect((await crate(page)).outside![2]).toBeLessThanOrEqual(h1);

  await openTab(page, "Overview");
  await expect(panel(page).getByRole("region", { name: "Shipment" })).toContainText(`Shipment · ${await crateCount(page)} crates`);
  await shot(page, "size-limit-overview");

  // The per-crate check names the size limit next to the others.
  await openTab(page, "Checks");
  await expect(checks(page, "ok").filter({ hasText: "Within the per-crate limits" })).toContainText("either way round");

  // Emptying the fields (no limit) puts the batch back in one crate.
  await openStandards(page);
  for (const label of ["Max crate length", "Max crate width", "Max crate height"]) {
    await standards(page).getByLabel(label).fill("");
    await standards(page).getByLabel(label).press("Enter");
  }
  await pollCrate(page, (s) => s.crateTypes.length === 1 && s.crateTypes[0].count === 1).toBe(true);
});

test("a part that is over the limit on its own ships in a crate each, and Checks says so", async ({ page }) => {
  await setQuantity(page, 1);
  const h1 = (await crate(page)).outside![2];
  // A height limit under what one part needs (the field's own minimum is 200 mm).
  const limit = Math.max(200, Math.floor(h1) - 40);
  expect(limit, "the bracket's crate is taller than the smallest limit the field takes").toBeLessThan(h1);
  await setQuantity(page, 4);

  await setStandard(page, "Max crate height", limit);
  await pollCrate(page, (s) => s.crateTypes.length === 1 && s.crateTypes[0].quantity === 1 && s.crateTypes[0].count).toBe(4);
  await shot(page, "size-limit-one-part-over");

  await openTab(page, "Checks");
  const over = checks(page, "caution").filter({ hasText: "Over the per-crate limit" });
  await expect(over).toContainText("One part alone is over the per-crate limit");
  await expect(over).toContainText(new RegExp(`outside height ${limit.toLocaleString("en-US")} mm at most`));
  await over.scrollIntoViewIfNeeded();
  await shot(page, "size-limit-one-part-over-checks");
});
