import { expect, test, type Page } from "@playwright/test";
import { layoutCards, openApp, openStandards, openTab, panel, setQuantity, setUnits, shot, standards, useTopRankedLayout } from "./helpers";

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
  await expect(card).toContainText(/÷ [\d,.]+ in³\/lb/); // the dim-weight divisor, set in the standards
  // It sits between the outside size and the build chain.
  const order = await panel(page).evaluate((el) => {
    const big = el.querySelector('[data-testid="outside-size"]')!;
    const sc = el.querySelector('[aria-label="Scorecard"]')!;
    const chain = el.querySelector('[data-testid="build-chain"]')!;
    return [big.compareDocumentPosition(sc), sc.compareDocumentPosition(chain)].map((p) => (p & 4) === 4); // FOLLOWING
  });
  expect(order).toEqual([true, true]);
  await shot(card, "scorecard-card");
  await shot(page, "scorecard-overview");

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
  await setQuantity(page, 8);
  await openTab(page, "Layouts");
  const cards = layoutCards(page);
  expect(await cards.count()).toBeGreaterThan(1);
  await expect(cards.first()).toContainText("top by volume");
  await expect(cards.first()).toContainText(/\$\d+ to build · class \d+/);
  // Every other card says how it compares in dollars and freight class.
  const count = await cards.count();
  for (let i = 1; i < count; i++) {
    await expect(cards.nth(i)).toContainText(/([+−]\$\d+|same cost) · (same class \d+|class \d+(\.5)? → \d+)/);
  }
  const toggle = panel(page).getByRole("group", { name: "Rank layouts by" });
  await expect(toggle.getByRole("button", { name: "Volume" })).toHaveAttribute("aria-pressed", "true");
  await shot(panel(page), "scorecard-layouts-panel");
  await shot(page, "scorecard-layouts-deltas");

  await toggle.getByRole("button", { name: "Crate cost" }).click();
  await expect(toggle.getByRole("button", { name: "Crate cost" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page)).toContainText("Ranked by crate cost");
  // No stable card is cheaper than the recommended one (stability is a hard constraint).
  const stable = cards.filter({ hasNotText: "may tip" });
  for (let i = 1; i < (await stable.count()); i++) {
    await expect(stable.nth(i)).not.toContainText(/−\$\d+ ·/);
  }
  await shot(panel(page), "scorecard-layouts-ranked-by-cost");

  await toggle.getByRole("button", { name: "Freight class" }).click();
  await expect(panel(page)).toContainText("Ranked by freight");
  await toggle.getByRole("button", { name: "Volume" }).click();
  await expect(panel(page)).not.toContainText("Ranked by");
});

test("changing the labour rate in Shop standards changes the crate cost", async ({ page }) => {
  // A standards change re-picks the layout by the ranking; start on that layout, not the sweep's.
  await useTopRankedLayout(page);
  await openTab(page, "Overview");
  const before = await crateCost(page);
  const { labour: labourBefore } = await costSplit(page);
  expect(before).toBeGreaterThan(0);

  await openStandards(page);
  const labour = standards(page).getByRole("region", { name: "Labour" });
  await expect(labour).toBeVisible();
  const rate = labour.getByLabel("Labour rate");
  const defaultRate = Number(await rate.inputValue());
  expect(defaultRate).toBeGreaterThan(0);
  await expect(labour.getByLabel("Per screw")).toBeVisible();
  await expect(standards(page).getByLabel("Screw cost")).toBeVisible();
  await expect(standards(page).getByLabel("Dim weight divisor")).toBeVisible();
  await rate.fill(String(defaultRate * 2));
  await expect(standards(page).getByText("Customised")).toBeVisible();
  await labour.getByRole("heading", { name: "Labour" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(labour, "scorecard-standards-labour-group");
  await shot(page, "scorecard-standards-labour");

  await openTab(page, "Overview");
  // Labour doubles (the rate doubled), so the crate is dearer by what
  // labour cost before, give or take the rounding of each dollar figure.
  await expect.poll(async () => Math.abs((await crateCost(page)) - (before + labourBefore)) <= 1).toBe(true);
  expect((await costSplit(page)).labour).toBeCloseTo(labourBefore * 2, -1);
  await expect(scorecard(page)).toContainText(`labour at $${defaultRate * 2}/h`);

  await openStandards(page);
  await standards(page).getByRole("button", { name: "Reset to defaults" }).click();
  await openTab(page, "Overview");
  await expect.poll(() => crateCost(page)).toBe(before);
});

test("the first export shows the time to design, without moving the card; an edit clears it", async ({ page }) => {
  await openTab(page, "Overview");
  await expect(scorecard(page)).not.toContainText("Designed in");
  const height = (await scorecard(page).boundingBox())!.height;
  await openTab(page, "Cut list");
  await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download cut list" }).click()]);
  await openTab(page, "Overview");
  await expect(scorecard(page)).toContainText(/Designed in \d+ s|Designed in \d+ m \d+ s/);
  // "Designed in" shares the heading row, so showing or clearing it moves nothing.
  expect((await scorecard(page).boundingBox())!.height).toBe(height);
  await shot(scorecard(page), "scorecard-designed-in");

  await setQuantity(page, 5);
  await openTab(page, "Overview");
  await expect(scorecard(page)).not.toContainText("Designed in");
  expect((await scorecard(page).boundingBox())!.height).toBe(height);
});
