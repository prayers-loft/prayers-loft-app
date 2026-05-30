// 06 — Offline behavior: with /api blocked the UI should never hard-crash.
//                        It should either show cached data or a graceful no-op.
//                        We DO NOT use the global failure gate here — /api
//                        failures are expected, console.error noise is OK.
import { expect, test } from "@playwright/test";
import { bootApp } from "./_helpers";

test.describe("@offline degraded mode", () => {
  test("app shell still renders when /api is offline", async ({ page }) => {
    // Boot first so cached data lands; THEN go offline.
    await bootApp(page, "prayer");

    await page.route("**/api/**", (route) => route.abort("failed"));

    await page.getByTestId("tab-scripture").click();
    await page.waitForTimeout(2000);

    // Tab bar is still present and reactive — that's the only contract here.
    await expect(page.getByTestId("bottom-tab-bar")).toBeVisible();
    await expect(page.getByTestId("tab-prayer")).toBeVisible();

    // Switch back to Prayer — shell should still respond.
    await page.getByTestId("tab-prayer").click();
    await expect(page.getByTestId("prayer-input")).toBeVisible({ timeout: 5000 });
  });

  test("prayer submission fails gracefully when /api is offline", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.route("**/api/**", (route) => route.abort("failed"));

    await page.getByTestId("prayer-input").fill("offline test");
    await page.getByTestId("begin-prayer-button").click();
    await page.waitForTimeout(4500);

    // The UI should not crash — Begin button or input should still be present.
    const inputStill = await page.getByTestId("prayer-input").isVisible().catch(() => false);
    const beginStill = await page.getByTestId("begin-prayer-button").isVisible().catch(() => false);
    expect(inputStill || beginStill, "app shell should survive offline submission").toBeTruthy();
  });
});
