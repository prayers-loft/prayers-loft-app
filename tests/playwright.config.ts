import { defineConfig, devices } from "@playwright/test";

// On CI we run with file-level parallelism to keep wall-clock under the
// workflow timeout. The legacy specs (01-18) are not yet hardened for
// concurrent backend state, but each spec file still runs serially within
// itself, so file-level isolation has been sufficient in practice. The new
// `00-smoke-ci.spec.ts` is explicitly designed to be parallel-safe.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: isCI,
  // Each retry of a Playwright test re-runs the whole test including its
  // (often slow) cold-launch boot. On CI we keep retries = 1 to claw back
  // wall-clock without sacrificing real flake recovery. Locally we keep
  // retries off so a failure surfaces immediately.
  retries: isCI ? 1 : 0,
  // File-level parallelism — Playwright still runs each test inside a file
  // serially (mode: "default" describes), but multiple files can fan out
  // across workers. Empirically this is the safest mid-step before per-test
  // isolation is fully implemented in the legacy specs.
  workers: isCI ? 3 : 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "playwright-report/results.json" }],
  ],
  use: {
    baseURL: process.env.PRAYERS_LOFT_URL || "http://localhost:3000",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "x-e2e": "prayers-loft" },
  },
  projects: [
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 393, height: 852 },
      },
    },
  ],
});
