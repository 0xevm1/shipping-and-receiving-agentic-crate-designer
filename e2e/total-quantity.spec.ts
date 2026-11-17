import { expect, test } from "@playwright/test";
import {
  fileInput,
  island,
  openApp,
  openTab,
  panel,
  pollCrate,
  serverAvailable,
  SERVER_SKIP_REASON,
  sharedJob,
  shot,
  triangleGlb,
  waitForLiveJob,
  waitForRecommended,
} from "./helpers";

/**
 * Total quantity on the shared job (#46, spec §7.16): "Parts to ship" plans the total in the
 * browser at once (crates × parts each, cost per part, why that many crates), the Overview's
 * shipment shows the same split, **Use** puts a crate type on screen, and the total is saved to
 * the job on the server. The plan's numbers are read from the page and the probe, not pinned.
 *
 * Needs the server side (Postgres, blob storage): skipped when `/api/v1/health` isn't ok. No queue
 * worker runs under `bun run e2e`, so the server's stored plan is covered by the integration tests.
 */

test.beforeEach(async ({ request }) => {
  test.skip(!(await serverAvailable(request)), SERVER_SKIP_REASON);
});

/** A GLB no earlier run uploaded, so the job (shared by everyone who loads it) starts with no total. */
function freshPart() {
  const x = 0.5 + (Date.now() % 100_000) / 1e7;
  return { name: "total-quantity-widget.glb", mimeType: "model/gltf-binary", buffer: triangleGlb([x, 0.35, 0.25]) };
}

test("Parts to ship plans the total, the Overview agrees, Use shows a crate, and the total is saved", async ({ page }) => {
  test.slow();
  await openApp(page);
  await fileInput(page).setInputFiles(freshPart());
  await expect(island(page).getByRole("heading", { name: "Total quantity widget", exact: true })).toBeVisible();
  const { quantity: recommended } = await waitForRecommended(page);
  await openTab(page, "Overview");
  await waitForLiveJob(page);

  // A total that can't go in one recommended crate.
  const total = recommended * 2 + 1;
  const field = sharedJob(page).getByLabel("Parts to ship");
  await field.fill(String(total));
  await field.press("Enter");

  const plan = sharedJob(page).getByTestId("total-plan");
  await expect(plan).toContainText(new RegExp(`^${total} parts → \\d+ crates? .*\\$\\d+\\.\\d{2} per part`));
  await expect(plan).toContainText(`${total} parts ship as`);
  // The crate types cover the total, and differ by at most one part.
  const rows = plan.getByRole("list", { name: `Crates for ${total} parts` }).getByRole("listitem");
  const types = (await rows.allTextContents()).map((t) => t.match(/Crate (\w): (\d+) × (\d+) parts/)!.slice(1));
  const counts = types.map(([, count, quantity]) => ({ count: Number(count), quantity: Number(quantity) }));
  expect(counts.reduce((s, t) => s + t.count * t.quantity, 0)).toBe(total);
  const sizes = counts.map((t) => t.quantity);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);

  // The Overview's shipment is the same split, not a second one.
  const shipment = panel(page).getByTestId("total-shipment");
  await expect(shipment).toContainText(`Shipment · ${total} parts`);
  for (const [label, count, quantity] of types) await expect(shipment).toContainText(`${count} × crate ${label} (${quantity}`);
  await shot(sharedJob(page), "total-quantity-plan");

  // Use puts crate A on screen.
  const a = counts[0]!;
  const useA = rows.first().getByRole("button");
  if (await useA.isEnabled()) await useA.click();
  await pollCrate(page, (s) => s.quantity).toBe(a.quantity);
  await expect(rows.first().getByRole("button", { name: "Crate A is on screen" })).toBeDisabled();

  // The total reached the job on the server.
  const jobId = await sharedJob(page).getByTestId("total-quantity").getAttribute("data-job-id");
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/v1/jobs/${jobId}`);
      return res.ok() ? (await res.json()).job.totalQuantity : null;
    })
    .toBe(total);
  await expect(sharedJob(page).getByText("Not synced yet")).toHaveCount(0);
});
