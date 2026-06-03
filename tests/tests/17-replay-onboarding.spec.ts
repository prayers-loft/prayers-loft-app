// 17 — Developer Tools: Replay Onboarding flow.
// Verifies that tapping Settings → Developer Tools → Replay Onboarding
// re-opens the onboarding carousel even when the seen-flag is set.
import { expect, test } from "@playwright/test";
import { bootApp } from "./_helpers";

test.describe("@dev-tools replay onboarding", () => {
  test("Replay Onboarding row triggers the carousel on demand", async ({ page }) => {
    // Boot the app (helper auto-skips onboarding via navigator.webdriver).
    await bootApp(page, "prayer");
    // Sanity: carousel is NOT showing under automation.
    await expect(page.getByTestId("onboarding")).toHaveCount(0);

    // Open Settings.
    await page.getByTestId("settings-icon-button").click();
    await page.waitForTimeout(500);

    // The replay button is present (may be off-screen in a long settings list).
    const replay = page.getByTestId("replay-onboarding-button");
    await expect(replay).toHaveCount(1);

    // Tap — onboarding modal appears immediately, even though the seen-flag is set.
    await replay.click();
    await expect(page.getByTestId("onboarding")).toBeVisible({ timeout: 4000 });

    // First slide rendered.
    await expect(page.getByTestId("onboarding-title-pray")).toBeVisible();

    // Advance through 3 slides and finish.
    await page.getByTestId("onboarding-next").click();
    await page.waitForTimeout(500);
    await page.getByTestId("onboarding-next").click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("onboarding-get-started")).toBeVisible();
    await page.getByTestId("onboarding-get-started").click();

    // Carousel dismisses cleanly.
    await expect(page.getByTestId("onboarding")).toHaveCount(0, { timeout: 4000 });
  });
});
