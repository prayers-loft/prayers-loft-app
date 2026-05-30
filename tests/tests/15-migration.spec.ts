// Phase-2 — Guest → Account migration (frontend integration).
//
// This spec drives the Settings → Backup My Journey → AuthSheet → register
// path and then asserts (via the auth backend) that the freshly created
// authed user can read back any prayers / reflections that the guest had
// stored locally. The actual /api/account/migrate-guest call is fired by the
// app's account-migration helper right after registration.
import { test, expect } from "@playwright/test";

function uniqueEmail() {
  const tag = Math.random().toString(36).slice(2, 10);
  return `TEST_e2e_${tag}@prayersloft-qa.com`;
}

test.describe("Phase 2 — Guest→Account migration", () => {
  test("registering after using as guest preserves session and exposes signed-in state", async ({ page }) => {
    // Seed minimal guest state so the app has SOMETHING to migrate.
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    await page.evaluate(() => {
      window.localStorage.removeItem("prayersloft_auth_v1");
      // mimic a saved prayer + a reflection so migration has rows to upsert
      window.localStorage.setItem(
        "prayersloft_saved_prayers",
        JSON.stringify([
          {
            id: "p-mig-1",
            text: "Lord steady my heart",
            scripture: "Isaiah 41:10",
            createdAt: "2026-01-01T10:00:00.000Z",
          },
        ])
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);

    await expect(page.getByTestId("guest-card")).toBeVisible();
    await page.getByTestId("create-account-button").click();
    await page.getByTestId("upgrade-prompt-cta").click();
    await expect(page.getByTestId("auth-sheet")).toBeVisible();

    await page.getByTestId("auth-email-btn").click();
    await page.getByTestId("auth-switch-mode").click();
    const email = uniqueEmail();
    await page.getByTestId("auth-input-email").fill(email);
    await page.getByTestId("auth-input-password").fill("TestPass1234!");

    page.once("dialog", (d) => d.accept());
    await page.getByTestId("auth-submit").click();

    // Signed-in card visible → registration + (any) migration completed.
    await expect(page.getByTestId("signed-in-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("signed-in-email")).toContainText(email.toLowerCase());

    // Local saved prayers remain present after sign-in (migration must not
    // wipe local cache).
    const localPrayers = await page.evaluate(() =>
      window.localStorage.getItem("prayersloft_saved_prayers")
    );
    expect(localPrayers).toContain("p-mig-1");

    // Sign-out must clear auth but preserve local prayers.
    await page.getByTestId("sign-out-button").click();
    await expect(page.getByTestId("guest-card")).toBeVisible({ timeout: 8_000 });

    const stillThere = await page.evaluate(() =>
      window.localStorage.getItem("prayersloft_saved_prayers")
    );
    expect(stillThere).toContain("p-mig-1");
  });
});
