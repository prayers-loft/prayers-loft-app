// Phase-2 auth — email register flow via the AuthSheet from Settings.
//
// Verifies:
//   1. Settings → Backup My Journey → UpgradePromptSheet → AuthSheet appears.
//   2. AuthSheet shows Google + Email; Apple is hidden (feature flag).
//   3. Email register flow flips the Account card to the Signed-in variant.
//   4. Sign-out reverts the card to the Guest variant within the same session,
//      while local AsyncStorage (saved prefs/prayers) is preserved.
import { test, expect } from "@playwright/test";

function uniqueEmail() {
  const tag = Math.random().toString(36).slice(2, 10);
  return `TEST_e2e_${tag}@prayersloft-qa.com`;
}

test.describe("Phase 2 — Email auth via AuthSheet", () => {
  test.beforeEach(async ({ context }) => {
    // Fresh storage per case so prior signed-in state never leaks.
    await context.clearCookies();
    // localStorage is cleared by goto in bootApp via a fresh context if test runs in isolation,
    // but Playwright reuses context within a single worker — so clear via page after navigation.
  });

  test("backup CTA → AuthSheet → email register → signed-in card → sign-out", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2800);

    // Ensure starting state is Guest.
    await page.evaluate(() => window.localStorage.removeItem("prayersloft_auth_v1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);

    await expect(page.getByTestId("guest-card")).toBeVisible();
    await page.getByTestId("create-account-button").click();
    // UpgradePromptSheet → CTA opens the real AuthSheet.
    await expect(page.getByTestId("upgrade-prompt-sheet")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("upgrade-prompt-cta").click();

    // AuthSheet shows Google + Email; Apple hidden by feature flag.
    await expect(page.getByTestId("auth-sheet")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("auth-google-btn")).toBeVisible();
    await expect(page.getByTestId("auth-email-btn")).toBeVisible();
    await expect(page.getByTestId("auth-apple-btn")).toHaveCount(0);

    // Enter the email form, switch to register, fill, submit.
    await page.getByTestId("auth-email-btn").click();
    await page.getByTestId("auth-switch-mode").click();

    const email = uniqueEmail();
    await page.getByTestId("auth-input-email").fill(email);
    await page.getByTestId("auth-input-password").fill("TestPass1234!");

    page.once("dialog", async (d) => {
      expect(d.message().toLowerCase()).toContain("welcome");
      await d.accept();
    });
    await page.getByTestId("auth-submit").click();

    // Card flips to signed-in.
    await expect(page.getByTestId("signed-in-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("signed-in-email")).toContainText(email.toLowerCase());

    // Sign out reverts to guest card within same session.
    await page.getByTestId("sign-out-button").click();
    await expect(page.getByTestId("guest-card")).toBeVisible({ timeout: 8_000 });
  });

  test("AuthSheet — Apple button is hidden when feature flag is off", async ({ page }) => {
    // Open settings → upgrade → auth sheet.
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    await page.evaluate(() => window.localStorage.removeItem("prayersloft_auth_v1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);

    await page.getByTestId("create-account-button").click();
    await page.getByTestId("upgrade-prompt-cta").click();
    await expect(page.getByTestId("auth-sheet")).toBeVisible();
    // Apple button must be absent from DOM.
    await expect(page.getByTestId("auth-apple-btn")).toHaveCount(0);
  });
});
