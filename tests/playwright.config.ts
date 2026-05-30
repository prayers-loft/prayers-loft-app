import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
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
