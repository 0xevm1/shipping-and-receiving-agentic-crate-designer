import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, openTab, panel, pollCrate, setUnits, tab } from "./helpers";

/** The island's keyboard and screen-reader behaviour: tabs pattern, cut-list toggles, library focus. */

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
