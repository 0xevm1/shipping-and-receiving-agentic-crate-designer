import { test, type Locator, type Page } from "@playwright/test";

/** Where every spec writes pictures. Git-ignored; CI uploads it as the `e2e-screenshots` artifact. */
export const SCREENSHOT_DIR = "e2e/screenshots";

/**
 * The one screenshot helper. A page is shot full-page, a locator is cropped to its element.
 * `name` starts with the spec's topic (`part-header-standin`); a run in a project other than
 * desktop adds the project (`layout-mobile-390-closed`), so the phone and desktop shots don't
 * overwrite each other. Playwright creates the folder.
 */
export async function shot(target: Page | Locator, name: string) {
  const project = test.info().project.name;
  const file = project === "desktop" ? name : `${name}-${project}`;
  const path = `${SCREENSHOT_DIR}/${file}.png`;
  if ("goto" in target) await target.screenshot({ path, fullPage: true });
  else await target.screenshot({ path });
}

/** Attaches a generated file (a PDF, say) to the HTML report instead of writing it into the repo. */
export async function attach(name: string, body: Buffer | Uint8Array, contentType: string) {
  await test.info().attach(name, { body: Buffer.from(body), contentType });
}
