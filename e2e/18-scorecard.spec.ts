import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, openTab, panel, pollCrate, setUnits, shot } from "./helpers";

/**
 * Design scorecard (#17): crate cost (material + labour), build time, freight class and
 * density, dimensional weight on the Overview; deltas and the ranking toggle on Layouts; the
 * labour rate in Shop standards; and the time-to-design note after the first export.
 */

const scorecard = (page: Page) => panel(page).getByRole("region", { name: "Scorecard" });

/** The "Crate cost" tile's dollars. */
const crateCost = async (page: Page) => {
  const text = await scorecard(page).locator("div", { hasText: "Crate cost" }).locator("dd").first().textContent();
  return Number((text ?? "").replace(/[$,]/g, ""));
};

/** The tile's "$91 material + $95 labour" line as numbers. */
const costSplit = async (page: Page) => {
  const text = (await scorecard(page).textContent()) ?? "";
  const m = /\$([\d,]+) material \+ \$([\d,]+) labour/.exec(text);
  if (!m) throw new Error(`No cost split in: ${text}`);
  return { material: Number(m[1].replace(/,/g, "")), labour: Number(m[2].replace(/,/g, "")) };
};

/** The first number in `text`, as written ("26.7 lb/ft³" gives 26.7). */
const first = (text: string | null) => Number(/[\d,]+(\.\d+)?/.exec(text ?? "")?.[0].replace(/,/g, ""));

/** What a scorecard tile shows, by its label. */
const tile = async (page: Page, label: string) => (await scorecard(page).locator("div", { hasText: label }).locator("dd").first().textContent()) ?? "";

/** Element crops for the PR (the full-page shots stay in e2e/screenshots). */
async function crop(locator: Locator, name: string) {
  mkdirSync("e2e/screenshots/crops", { recursive: true });
  await locator.screenshot({ path: `e2e/screenshots/crops/${name}.png` });
}

const standards = (page: Page) => panel(page).locator("details", { hasText: "Shop standards" });

async function openStandards(page: Page) {
  await openTab(page, "Rules");
  await standards(page).getByText("Shop standards", { exact: true }).click();
  await expect(standards(page)).toHaveAttribute("open", "");
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("the Overview shows the scorecard under the outside size, in imperial by default", async ({ page }) => {
  await openTab(page, "Overview");
  const card = scorecard(page);
  await expect(card).toBeVisible();
  // The numbers themselves are pinned by the domain unit tests (spec §7.11); this checks the
  // card is wired to them: every tile is there, in the right format, and the parts add up.
  await expect(card).toContainText("Crate cost");
  await expect(card).toContainText("Build time");
  await expect(card).toContainText("Freight class");
  await expect(card).toContainText("Dim weight");
  const cost = await crateCost(page);
  expect(cost).toBeGreaterThan(0);
  const { material, labour } = await costSplit(page);
  // Each part is rounded to whole dollars on its own, so the sum can be a dollar off.
  expect(Math.abs(material + labour - cost)).toBeLessThanOrEqual(1);
  expect(await tile(page, "Build time")).toMatch(/^(\d+ h )?\d+ m$/);
  expect(await tile(page, "Freight class")).toMatch(/^\d+(\.5)?$/);
  await expect(card).toContainText(/\d+\.\d lb\/ft³/);
  const dimLb = first(await tile(page, "Dim weight"));
  expect(await tile(page, "Dim weight")).toMatch(/^\d+ lb$/);
  await expect(card).toContainText("÷ 139 in³/lb"); // the shipped dim-weight divisor, read from the standards
  // It sits between the outside size and the build chain.
  const order = await panel(page).evaluate((el) => {
    const big = el.querySelector(".big")!;
    const sc = el.querySelector('[aria-label="Scorecard"]')!;
    const chain = el.querySelector(".chain")!;
    return [big.compareDocumentPosition(sc), sc.compareDocumentPosition(chain)].map((p) => (p & 4) === 4); // FOLLOWING
  });
  expect(order).toEqual([true, true]);
  await crop(card, "17-overview-scorecard");
  await shot(page, "17-overview-scorecard");

  const lbFt3 = first(/(\d+\.\d) lb\/ft³/.exec((await card.textContent()) ?? "")?.[1] ?? null);
  await setUnits(page, "metric");
  // The same figures in metric: 1 lb/ft³ is 16.0185 kg/m³, and 1 kg is 2.20462 lb.
  const kgM3 = first(/([\d,]+) kg\/m³/.exec((await card.textContent()) ?? "")?.[1] ?? null);
  expect(Math.abs(kgM3 - lbFt3 * 16.0185)).toBeLessThanOrEqual(1);
  const dimKg = first(await tile(page, "Dim weight"));
  expect(await tile(page, "Dim weight")).toMatch(/^\d+ kg$/);
  expect(Math.abs(dimKg - dimLb / 2.20462)).toBeLessThanOrEqual(1);
});

test("the Layouts cards show deltas against the recommendation, and the ranking toggle re-ranks", async ({ page }) => {
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await openTab(page, "Layouts");
  await expect(panel(page).locator("button.opt")).toHaveCount(4);
  const cards = panel(page).locator("button.opt");
  await expect(cards.first()).toContainText("recommended");
  await expect(cards.first()).toContainText(/\$\d+ to build · class \d+/);
  // Every other card says how it compares in dollars and freight class.
  const count = await cards.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 1; i < count; i++) {
    await expect(cards.nth(i)).toContainText(/([+−]\$\d+|same cost) · (same class \d+|class \d+(\.5)? → \d+)/);
  }
  const toggle = panel(page).getByRole("group", { name: "Rank layouts by" });
  await expect(toggle.getByRole("button", { name: "Volume" })).toHaveAttribute("aria-pressed", "true");
  await crop(panel(page), "17-layouts-deltas");
  await shot(page, "17-layouts-deltas");

  await toggle.getByRole("button", { name: "Crate cost" }).click();
  await expect(toggle.getByRole("button", { name: "Crate cost" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page)).toContainText("Ranked by crate cost");
  // No stable card is cheaper than the recommended one (stability is a hard constraint).
  const stable = cards.filter({ hasNotText: "may tip" });
  for (let i = 1; i < (await stable.count()); i++) {
    await expect(stable.nth(i)).not.toContainText(/−\$\d+ ·/);
  }
  await crop(panel(page), "17-layouts-ranked-by-cost");

  await toggle.getByRole("button", { name: "Freight class" }).click();
  await expect(panel(page)).toContainText("Ranked by freight");
  await toggle.getByRole("button", { name: "Volume" }).click();
  await expect(panel(page)).not.toContainText("Ranked by");
});

test("changing the labour rate in Shop standards changes the crate cost", async ({ page }) => {
  await openTab(page, "Overview");
  const before = await crateCost(page);
  const { labour: labourBefore } = await costSplit(page);
  expect(before).toBeGreaterThan(0);

  await openStandards(page);
  const labour = standards(page).getByRole("region", { name: "Labour" });
  await expect(labour).toBeVisible();
  const rate = labour.getByLabel("Labour rate");
  await expect(rate).toHaveValue("35");
  await expect(labour.getByLabel("Per screw")).toHaveValue("0.15");
  await expect(standards(page).getByLabel("Screw cost")).toHaveValue("8");
  await expect(standards(page).getByLabel("Dim weight divisor")).toHaveValue("139");
  await rate.fill("70");
  await expect(standards(page).getByText("Customised")).toBeVisible();
  await labour.getByRole("heading", { name: "Labour" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await crop(labour, "17-standards-labour");
  await shot(page, "17-standards-labour");

  await openTab(page, "Overview");
  // Labour doubles (the rate went from $35 to $70 an hour), so the crate is dearer by what
  // labour cost before, give or take the rounding of each dollar figure.
  await expect.poll(async () => Math.abs((await crateCost(page)) - (before + labourBefore)) <= 1).toBe(true);
  expect((await costSplit(page)).labour).toBeCloseTo(labourBefore * 2, -1);
  await expect(scorecard(page)).toContainText("labour at $70/h");

  await openStandards(page);
  await standards(page).getByRole("button", { name: "Reset to defaults" }).click();
  await openTab(page, "Overview");
  await expect.poll(() => crateCost(page)).toBe(before);
});

test("the first export shows the time to design", async ({ page }) => {
  await openTab(page, "Overview");
  await expect(scorecard(page)).not.toContainText("Designed in");
  await openTab(page, "Cut list");
  await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download cut list" }).click()]);
  await openTab(page, "Overview");
  await expect(scorecard(page)).toContainText(/Designed in \d+ s|Designed in \d+ m \d+ s/);
  await crop(scorecard(page), "17-overview-designed-in");
});
