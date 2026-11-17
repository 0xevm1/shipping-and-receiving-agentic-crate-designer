import { expect, test } from "@playwright/test";
import { crate, cutRows, island, layoutCards, mmText, openApp, openTab, otherLayout, panel, pickedLayout, setUnits, shot, tab } from "./helpers";

/** The island's tabs: what each shows, and how the tab strip works from the keyboard. */

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("Overview shows the build chain and weight by assembly", async ({ page }) => {
  const chain = panel(page).getByTestId("build-chain").getByRole("listitem");
  await expect(chain).toHaveCount(6);
  for (const [i, step] of ["Parts", "Layout", "Walls and lid", "Base", "Blocking", "Gross weight"].entries()) {
    await expect(chain.nth(i)).toContainText(step);
  }
  await expect(panel(page).getByRole("heading", { name: "Crate weight by assembly" })).toBeVisible();
  // Each weight bar is a named group ("Base, 20 kg") the keyboard can reach.
  const bar = panel(page).getByTestId("weight-bar").first();
  await expect(bar).toHaveAttribute("role", "group");
  await expect(bar).toHaveAttribute("aria-label", /\d/);
  await shot(page, "island-overview");
});

test("Layouts says the crate on screen is the recommendation, and a layout picked by hand says so", async ({ page }) => {
  await openTab(page, "Layouts");
  await expect(panel(page).getByRole("heading", { name: "Ways to pack it" })).toBeVisible();
  // Layout cards only: the Rank by toggle has pressed buttons too.
  await expect(pickedLayout(page)).toHaveCount(1);
  await expect(pickedLayout(page)).toContainText(mmText((await crate(page)).outside!));
  expect(await layoutCards(page).count()).toBeGreaterThan(1);

  // The app opens at the sweep's crate, cheapest per part, which for the sample part isn't the top of
  // the volume ranking (src/lib/shapedRoundTrip.test.ts): the tab says it is the recommendation.
  await expect.poll(async () => (await crate(page)).layoutPick).toBe("recommendation");
  const note = panel(page).getByTestId("layout-recommended");
  await expect(note).toContainText("Recommended: cheapest per part");
  await expect(note).toContainText("ranked by volume");
  await expect(panel(page)).not.toContainText("Your pick");
  await note.getByRole("button", { name: "why?" }).click();
  await expect(panel(page).getByTestId("recommendation-why")).toBeVisible();
  await shot(panel(page), "island-layouts-recommended");

  // A layout picked by hand (neither the list's top nor the recommendation's) says so.
  await otherLayout(page).filter({ hasNotText: "recommended" }).first().click();
  await expect.poll(async () => (await crate(page)).layoutPick).toBe("hand");
  await expect(panel(page)).toContainText("Your pick ships");
  await expect(panel(page).getByTestId("layout-recommended")).toHaveCount(0);
  await shot(page, "island-layouts");
});

test("Cut list groups boards by assembly", async ({ page }) => {
  await openTab(page, "Cut list");
  for (const group of ["Base", "Side walls", "End walls", "Lid", "Inside the crate"]) {
    await expect(panel(page).getByRole("cell", { name: group, exact: true })).toBeVisible();
  }
  expect(await cutRows(page).count()).toBeGreaterThan(5);
  await expect(panel(page).getByRole("button", { name: "Download cut list" })).toBeVisible();
  await shot(page, "island-cut-list");
});

test("Rules shows the packing controls", async ({ page }) => {
  await openTab(page, "Rules");
  await expect(panel(page).getByLabel("Quantity")).toHaveValue(String((await crate(page)).quantity));
  await expect(panel(page).getByLabel("Keep parts upright")).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Most layers allowed" })).toBeVisible();
  await expect(panel(page).getByLabel("Gap between parts")).toBeVisible();
  await expect(panel(page).getByLabel("Clearance to walls")).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Wall and lid plywood" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Reset rules" })).toBeVisible();
  await shot(page, "island-rules");
});

test("the tabs are one tab stop; arrows, Home and End move and select, and the panel is labelled by its tab", async ({ page }) => {
  const overview = tab(page, "Overview");
  await expect(overview).toHaveAttribute("tabindex", "0");
  await expect(tab(page, "Layouts")).toHaveAttribute("tabindex", "-1");

  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Layouts")).toBeFocused();
  await expect(tab(page, "Layouts")).toHaveAttribute("aria-selected", "true");
  await expect(panel(page)).toHaveAttribute("aria-labelledby", (await tab(page, "Layouts").getAttribute("id"))!);
  await expect(tab(page, "Layouts")).toHaveAttribute("aria-controls", (await panel(page).getAttribute("id"))!);

  await page.keyboard.press("End");
  await expect(tab(page, "Checks")).toBeFocused();
  await page.keyboard.press("ArrowRight"); // wraps
  await expect(tab(page, "Overview")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Checks")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab(page, "Overview")).toBeFocused();
  await expect(overview).toHaveAttribute("aria-selected", "true");

  // Tab leaves the tablist for the panel instead of stepping through the other four tabs.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab").and(page.locator(":focus"))).toHaveCount(0);
});

test("scrolled panel content fades under the tab strip, and only when scrolled", async ({ page }) => {
  await openTab(page, "Rules");
  const p = panel(page);
  await expect(p).not.toHaveAttribute("data-scrolled", "");
  await p.evaluate((el) => (el.scrollTop = 120));
  await expect(p).toHaveAttribute("data-scrolled", "");
  expect(await p.evaluate((el) => getComputedStyle(el).maskImage)).toContain("linear-gradient");
  await shot(page, "island-panel-fade");
  await p.evaluate((el) => (el.scrollTop = 0));
  await expect(p).not.toHaveAttribute("data-scrolled", "");
});

test("the island keeps one height on every tab", async ({ page }) => {
  const heights: number[] = [];
  for (const name of ["Overview", "Layouts", "Cut list", "Rules", "Checks"]) {
    await openTab(page, name);
    heights.push((await island(page).boundingBox())!.height);
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
});
