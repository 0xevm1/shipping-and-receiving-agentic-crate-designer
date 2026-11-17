import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end UI tests (#34). `bun run e2e` builds the production app with the read-only
 * test hook (`NEXT_PUBLIC_E2E=1`, see `src/components/viewer/E2EProbe.tsx`) and serves it on
 * port 3320. Specs live in `e2e/`; screenshots go to `e2e/screenshots/` (git-ignored).
 *
 * Set `E2E_SKIP_BUILD=1` to serve an existing e2e build instead (CI builds in its own step).
 */
const PORT = 3320;
const baseURL = `http://localhost:${PORT}`;

/** SwiftShader gives headless Chromium a software WebGL, so the 3D canvas really renders. */
const webglArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a test that needs one is flaky and should be fixed, not hidden.
  retries: 0,
  // Software WebGL is CPU-heavy; a few workers keep frame times (and timings) steady.
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
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
      testIgnore: /\.narrow\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Below the 980 px breakpoint: the stacked layout.
      name: "narrow",
      testMatch: /\.narrow\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 900, height: 900 } },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? `bun run start -p ${PORT}` : `bun run build && bun run start -p ${PORT}`,
    url: baseURL,
    env: { NEXT_PUBLIC_E2E: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
