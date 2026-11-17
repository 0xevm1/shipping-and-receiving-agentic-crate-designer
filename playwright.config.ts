import { cpus } from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { databaseUrl, loadLocalEnv, withDatabase } from "./src/server/db/config";

/**
 * End-to-end UI tests. `bun run e2e` builds the production app with the read-only
 * test hook (`NEXT_PUBLIC_E2E=1`, see `src/components/viewer/E2EProbe.tsx`) and serves it on
 * port 3320. Specs live in `e2e/`; screenshots go to `e2e/screenshots/` (git-ignored).
 *
 * Set `E2E_SKIP_BUILD=1` to serve an existing e2e build instead (CI builds in its own step).
 * Set `E2E_PORT` to use another port. Parallel worktrees need distinct ports, because a local run
 * reuses whatever server is already listening and would otherwise test another branch's build.
 *
 * The server (#46): before building, the run starts Postgres and the blob emulator from
 * docker-compose.yml (`infra:up`) and migrates **its own database**, `crate_designer_e2e`
 * (`E2E_DB_NAME`), on the same Postgres, so a run never touches the dev data; files go to the
 * `crate-designer-test` bucket (`E2E_BLOB_BUCKET`). Without Docker the app still serves, and the
 * specs that need the server skip (`serverAvailable`, e2e/helpers/server.ts). `E2E_SKIP_INFRA=1`
 * skips the Docker step (CI starts and migrates in steps of its own).
 */
const PORT = Number(process.env.E2E_PORT) || 3320;
const baseURL = `http://localhost:${PORT}`;

loadLocalEnv();
const E2E_DATABASE_URL = withDatabase(databaseUrl(), process.env.E2E_DB_NAME || "crate_designer_e2e");
const serverEnv = {
  NEXT_PUBLIC_E2E: "1",
  DATABASE_URL: E2E_DATABASE_URL,
  BLOB_BUCKET: process.env.E2E_BLOB_BUCKET || "crate-designer-test",
};
const infra = process.env.E2E_SKIP_INFRA
  ? "true"
  : `(bun scripts/infra.ts up && bun scripts/infra.ts migrate) || echo "e2e: no database (is Docker running?); specs that need the server will skip"`;
const serve = process.env.E2E_SKIP_BUILD ? `bun run start -p ${PORT}` : `bun run build && bun run start -p ${PORT}`;

/**
 * Local workers. Software WebGL is CPU-heavy, and several worktrees (or agents) often run a suite at once, so
 * the default is a third of the cores, between 1 and 3, instead of every core. Set `E2E_WORKERS` to change it.
 */
const localWorkers = Math.max(1, Math.min(3, Math.floor(cpus().length / 3)));

/** SwiftShader gives headless Chromium a software WebGL, so the 3D canvas really renders. */
const webglArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a test that needs one is flaky and should be fixed, not hidden.
  retries: 0,
  // Software WebGL is CPU-heavy. The private repo's CI runner has 2 vCPUs, where two
  // SwiftShader workers starve each other's frames, so CI runs one, with more headroom.
  workers: process.env.CI ? 1 : Number(process.env.E2E_WORKERS) || localWorkers,
  // `test.slow()` triples it for the long flows (a reload, several model loads).
  timeout: process.env.CI ? 120_000 : 60_000,
  expect: { timeout: process.env.CI ? 20_000 : 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    // Idle auto-play off and transitions instant (spec §8.4); one test turns motion back on.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: webglArgs },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /\.(narrow|mobile)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Below the 980 px breakpoint with a mouse (a small window or a tablet): the drawer layout.
      name: "narrow",
      testMatch: /\.narrow\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 900, height: 900 } },
    },
    // Phones: touch, a mobile viewport and the drawer layout. Same specs at both sizes.
    {
      name: "mobile-390",
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: "mobile-360",
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `${infra}; ${serve}`,
    url: baseURL,
    env: serverEnv,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
