import { expect, type BrowserContext, type Page } from "@playwright/test";
import { openTab, panel } from "./locators";

declare global {
  interface Window {
    /** How many times the page asked to print (counted by `stubPrint`). */
    __printCalls?: number;
  }
}

/**
 * Counts print dialogs instead of opening one. Applies to every page of the context, including the
 * print tab the Cut list opens, and survives a navigation.
 */
export async function stubPrint(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls = (window.__printCalls ?? 0) + 1;
    };
  });
}

/**
 * Stops the part-shape analysis, which waits for the browser to be idle, so blocking stays on the
 * part's bounding box. Call before the page loads.
 */
export async function disableShapeAnalysis(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
}

/**
 * Clicks "Print / save PDF" on the Cut list and returns the print tab (opened with the design in its
 * URL hash) once its crate spec is drawn. The page's context must have called `stubPrint`.
 */
export async function openPrintTab(page: Page, units?: "imperial" | "metric") {
  await openTab(page, "Cut list");
  const [popup] = await Promise.all([page.waitForEvent("popup"), panel(page).getByRole("button", { name: "Print / save PDF" }).click()]);
  await expect(panel(page).getByRole("status")).toHaveText("Print view opened in a new tab.");
  if (units) expect(popup.url()).toMatch(new RegExp(`/print#design=[A-Za-z0-9_-]+&u=${units}&print=1$`));
  await expect(popup.getByRole("region", { name: "Crate spec" })).toBeVisible();
  return popup;
}

/** A printed sheet (a labelled region of the print route). */
export const sheet = (print: Page, name: string) => print.getByRole("region", { name, exact: true });
