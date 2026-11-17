import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  fileInput,
  island,
  openApp,
  openTab,
  panel,
  pollCrate,
  readDownloadZip,
  savedConfigs,
  serverAvailable,
  SERVER_SKIP_REASON,
  setQuantity,
  sharedJob,
  shot,
  triangleGlb,
  waitForLiveJob,
  waitForRecommended,
} from "./helpers";

/**
 * The shared job end to end (#46): a part is loaded, the best quantity is shown without asking,
 * the crate is saved to the part's job on the server, a second browser on the same part sees each
 * save arrive live (LISTEN/NOTIFY → SSE, no reload), and Download all bundles the job's saved
 * configurations with a folder each and a manifest.
 *
 * Needs the server side (Postgres, blob storage): skipped when `/api/v1/health` isn't ok.
 */

test.beforeEach(async ({ request }) => {
  test.skip(!(await serverAvailable(request)), SERVER_SKIP_REASON);
});

/**
 * A GLB no earlier run uploaded: the database outlives a run, and a job is shared by everyone who
 * loads the same model, so a fixed file would find the configurations an earlier run saved.
 * About 0.6 × 0.4 × 0.3 m, read as metres.
 */
function freshPart() {
  const x = 0.6 + (Date.now() % 100_000) / 1e7;
  return { name: "shared-job-widget.glb", mimeType: "model/gltf-binary", buffer: triangleGlb([x, 0.4, 0.3]) };
}

/** Loads `file` and waits until the crate is designed for it and its shared job is live. */
async function loadPart(page: Page, file: ReturnType<typeof freshPart>) {
  await fileInput(page).setInputFiles(file);
  await expect(island(page).getByRole("heading", { name: "Shared job widget", exact: true })).toBeVisible();
  await pollCrate(page, (s) => s.outside).not.toBeNull();
  // A new part opens at its recommended quantity (spec §7.16).
  await waitForRecommended(page);
  await openTab(page, "Overview");
  await waitForLiveJob(page);
}

/** A second, separate browser (its own storage) on the same app, like a colleague's tablet. */
async function secondBrowser(browser: Browser, page: Page) {
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, reducedMotion: "reduce", viewport: page.viewportSize() });
  return { context, page: await context.newPage() };
}

test("a saved configuration reaches another browser live, and Download all bundles the job", async ({ page, browser }) => {
  test.slow();
  const part = freshPart();
  await openApp(page);
  await loadPart(page, part);

  // The other browser opens the same part: same job, nothing saved to it yet.
  const other = await secondBrowser(browser, page);
  try {
    const b = other.page;
    await openApp(b);
    await loadPart(b, part);
    await expect(savedConfigs(b)).toHaveCount(0);

    // The part opened at the best quantity per crate, without choosing one: the hint says it is in use.
    await openTab(page, "Rules");
    const best = panel(page).getByTestId("best-quantity");
    await expect(best).toHaveAttribute("aria-busy", "false");
    const recommended = Number((await best.textContent())!.match(/Best: (\d+) per crate/)![1]);
    await pollCrate(page, (s) => s.quantity).toBe(recommended);
    await expect(best.getByRole("button", { name: "In use" })).toBeDisabled();
    await shot(page, "shared-job-best-quantity");

    // Save it in A. B lists it without a reload (the save → event → SSE path; 5 s is generous).
    await openTab(page, "Overview");
    await sharedJob(page).getByRole("button", { name: "Save to job" }).click();
    await expect(sharedJob(page).getByRole("button", { name: "Saved to job" })).toBeDisabled();
    await expect(savedConfigs(page)).toHaveCount(1);
    await expect(savedConfigs(page).first()).not.toContainText("Not synced yet");
    await expect(savedConfigs(b)).toHaveCount(1, { timeout: 5_000 });
    await expect(
      savedConfigs(b)
        .first()
        .getByRole("button", { name: `Use the ${recommended}-part configuration` }),
    ).toBeVisible();

    // A second configuration, a different quantity per crate, arrives the same way.
    const another = recommended === 1 ? 2 : 1;
    await setQuantity(page, another);
    await openTab(page, "Overview");
    await sharedJob(page).getByRole("button", { name: "Save to job" }).click();
    await expect(savedConfigs(page)).toHaveCount(2);
    await expect(savedConfigs(b)).toHaveCount(2, { timeout: 5_000 });
    await expect(sharedJob(b).getByRole("button", { name: `Use the ${another}-part configuration` })).toBeVisible();
    await shot(sharedJob(b), "shared-job-second-browser");

    // Download all in B: one folder per saved configuration, the comparison and the manifest.
    const downloadAll = sharedJob(b).getByRole("button", { name: "Download all saved (2)" });
    const [download] = await Promise.all([b.waitForEvent("download"), downloadAll.click()]);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const files = await readDownloadZip(download);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    expect(manifest).toMatchObject({ kind: "crate-designer/bundle", costBasis: "crate-only" });
    const configs = manifest.configurations as { folder: string; quantity: number; files: { path: string; kind: string }[] }[];
    expect(configs.map((c) => c.quantity).sort()).toEqual([recommended, another].sort());
    for (const c of configs) {
      expect(c.files.map((f) => f.kind).sort()).toEqual(expect.arrayContaining(["csv", "glb", "pdf"]));
      for (const f of c.files) {
        expect(f.path.startsWith(`${c.folder}/`)).toBe(true);
        expect(files[f.path], f.path).toBeDefined();
      }
    }
    expect(files["comparison.pdf"]).toBeDefined();
  } finally {
    await other.context.close();
  }
});
