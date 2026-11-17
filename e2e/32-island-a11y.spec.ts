import { expect, test, type Page } from "@playwright/test";
import { crate, island, openApp, openTab, panel, pollCrate, setUnits, shot, tab } from "./helpers";

/** The island: keyboard and screen-reader behaviour, and the design-review items (verdict, fade, clock, shipment block). */

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
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

test("a cut-list row is a real toggle button: Space pins it, and the pin follows", async ({ page }) => {
  await openTab(page, "Cut list");
  const row = panel(page).locator("tr.row").first();
  const toggle = row.getByRole("button");
  await expect(row).not.toHaveAttribute("aria-pressed", /.*/);
  await toggle.focus();
  await pollCrate(page, (s) => s.hoverKey).not.toBeNull();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveClass(/pin/);
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect((await crate(page)).pin).toBeNull();
});

test("an Overview bar is a named group", async ({ page }) => {
  const bar = panel(page).locator(".barrow").first();
  await expect(bar).toHaveAttribute("role", "group");
  await expect(bar).toHaveAttribute("aria-label", /\d/);
});

const section = (page: Page) => panel(page).getByRole("region", { name: "Saved designs" });

test("Save, Rename and Delete leave focus on a sensible control", async ({ page }) => {
  await section(page).getByRole("button", { name: "Save design" }).click();
  const form = section(page).getByRole("form", { name: "Save this design" });
  await expect(form.getByLabel("Design name")).toBeFocused();
  await form.getByLabel("Design name").fill("Focus check");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText("Saved “Focus check”.");
  await expect(section(page).getByRole("button", { name: "Save design" })).toBeFocused();

  await section(page).getByRole("button", { name: "Rename Focus check" }).click();
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  await expect(section(page).getByRole("button", { name: /^Rename / })).toBeFocused();

  await section(page).getByRole("button", { name: /^Delete / }).click();
  await expect(section(page).getByRole("heading", { name: "Saved designs" })).toBeFocused();
  // The status announces the deletion; the Undo button sits outside the live region.
  await expect(section(page).getByRole("status")).toContainText("Deleted");
  await expect(section(page).getByRole("status").getByRole("button")).toHaveCount(0);
  await section(page).getByRole("button", { name: "Undo" }).click();
  await expect(section(page).getByRole("status")).toContainText("Restored");
  await expect(section(page).getByRole("heading", { name: "Saved designs" })).toBeFocused();
});

test("Shop standards render their inputs only while open, and a bad value is announced", async ({ page }) => {
  await openTab(page, "Rules");
  const details = panel(page).locator("details");
  await expect(details.getByLabel("Cleat thickness")).toHaveCount(0);
  await details.locator("summary").click();
  const field = details.getByLabel("Cleat thickness");
  await expect(field).toBeVisible();
  await field.fill("0");
  await expect(details.getByRole("alert")).toBeVisible();
  await expect(details.getByRole("alert")).not.toContainText(/stock\./);
});

async function setRule(page: Page, label: string, value: number | string) {
  await openTab(page, "Rules");
  await panel(page).getByLabel(label, { exact: true }).fill(String(value));
}

test.describe("Overview verdict", () => {
  test("says all clear, and names a caution with a link to Checks", async ({ page }) => {
    await expect(panel(page).locator(".verdict")).toHaveText("All checks clear");
    await shot(page, "32-verdict-clear");

    await setRule(page, "Gap between parts", 0);
    await openTab(page, "Overview");
    const verdict = panel(page).getByRole("button", { name: /1 caution: parts are not restrained/ });
    await expect(verdict).toBeVisible();
    await shot(page, "32-verdict-caution");
    await verdict.click();
    await expect(tab(page, "Checks")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).locator(".check.caution")).toContainText("Parts are not restrained");
  });

  test("the Checks tab counts cautions and info notes apart, both readable by a screen reader", async ({ page }) => {
    await setRule(page, "Gap between parts", 0);
    const checks = tab(page, "Checks");
    await expect(checks.locator(".count:not(.info)")).toContainText("caution");
    const notes = await panel(page).locator(".check.info").count();
    if (notes) await expect(checks.locator(".count.info")).toContainText(`${notes} note`);
    else await expect(checks.locator(".count.info")).toHaveCount(0);
  });
});

test("scrolled panel content fades under the tab strip, and only when scrolled", async ({ page }) => {
  await openTab(page, "Rules");
  const p = panel(page);
  await expect(p).not.toHaveAttribute("data-scrolled", "");
  await p.evaluate((el) => (el.scrollTop = 120));
  await expect(p).toHaveAttribute("data-scrolled", "");
  expect(await p.evaluate((el) => getComputedStyle(el).maskImage)).toContain("linear-gradient");
  await shot(page, "32-panel-fade");
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

test("'Designed in' sits in the scorecard's heading row: no shift on export, gone after an edit", async ({ page }) => {
  const card = panel(page).getByRole("region", { name: "Scorecard" });
  const before = (await card.boundingBox())!.height;
  await openTab(page, "Cut list");
  await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download cut list" }).click()]);
  await openTab(page, "Overview");
  await expect(card).toContainText(/Designed in/);
  expect((await card.boundingBox())!.height).toBe(before);
  await shot(page, "32-designed-in");

  await setRule(page, "Quantity", 5);
  await openTab(page, "Overview");
  await expect(card).not.toContainText("Designed in");
  expect((await card.boundingBox())!.height).toBe(before);
});

test.describe("a split shipment", () => {
  test.beforeEach(async ({ page }) => {
    await setRule(page, "Quantity", 200);
    await pollCrate(page, (s) => s.quantity).toBe(200);
    await openTab(page, "Overview");
  });

  test("shows its total cost and labour in the Shipment block, with grouped weights", async ({ page }) => {
    const ship = panel(page).getByRole("region", { name: "Shipment" });
    await expect(ship).toContainText(/\$[\d,]+ to build/);
    await expect(ship).toContainText(/\d+ h \d+ m of labour/);
    await expect(ship).toContainText(/gross [\d,]+ kg/);
    await expect(ship.locator("text=/\\d{4,} kg/")).toHaveCount(0);
    await expect(panel(page).getByRole("region", { name: "Scorecard" })).not.toContainText("Whole shipment");
    await shot(page, "32-shipment-block");
  });

  test("layout cards keep each unit on its number", async ({ page }) => {
    await openTab(page, "Layouts");
    const units = panel(page).locator(".opt-delta .nw");
    const count = await units.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = (await units.nth(i).boundingBox())!;
      expect(box.height, `delta part ${i} on one line`).toBeLessThan(22);
    }
    await shot(page, "32-layout-card");
  });
});

test("the cut list's piece names stay on one line", async ({ page }) => {
  await openTab(page, "Cut list");
  const picks = panel(page).locator(".cut .pick");
  const count = await picks.count();
  for (let i = 0; i < count; i++) expect((await picks.nth(i).boundingBox())!.height, `piece ${i}`).toBeLessThan(24);
  await shot(page, "32-cutlist-desktop");
});

test("the Overview names the part as the documents do", async ({ page }) => {
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Crate for 4 × Machined steel bracket");
});
