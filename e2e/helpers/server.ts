import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { panel } from "./locators";

/**
 * Whether the app's server side is usable: `GET /api/v1/health` answers 200 (the database is up).
 * Specs that need Postgres and blob storage skip when it isn't, so the UI suite still runs without
 * Docker: `test.skip(!(await serverAvailable(request)), SERVER_SKIP_REASON)`.
 */
export async function serverAvailable(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get("/api/v1/health", { timeout: 5_000 });
    return res.ok();
  } catch {
    return false;
  }
}

export const SERVER_SKIP_REASON = "GET /api/v1/health is not ok: start Postgres and the blob emulator (bun run infra:up && bun run db:migrate)";

/** The Overview's "Shared job" section (the part's job on the server). */
export const sharedJob = (page: Page): Locator => panel(page).getByRole("region", { name: "Shared job" });

/** The job's saved configurations, as listed in the Shared job section. */
export const savedConfigs = (page: Page): Locator => sharedJob(page).getByRole("list", { name: "Configurations saved to this job" }).getByRole("listitem");

/** Waits until the Shared job section's event stream is open (status "live"). The Overview tab must be open. */
export async function waitForLiveJob(page: Page) {
  await expect(sharedJob(page)).toContainText("other open tabs see saves as they happen", { timeout: 30_000 });
}
