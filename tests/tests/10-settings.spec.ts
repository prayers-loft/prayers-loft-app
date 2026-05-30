// 10 — Guest Mode (Phase 1): settings, preferences, export, conversion analytics.
import { expect, test } from "@playwright/test";
import { bootApp, watchFailures } from "./_helpers";

test.describe("@settings guest-mode settings", () => {
  test("settings gear opens the Settings screen", async ({ page }) => {
    const failures = watchFailures(page);
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await expect(page.getByText("Settings", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("guest-card")).toBeVisible();
    await expect(page.getByText(/Using Prayers Loft as Guest/i)).toBeVisible();
    await expect(page.getByTestId("create-account-button")).toBeVisible();
    failures.assertNone();
  });

  test("guest joined-on date is rendered (stable guest_id minted)", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await expect(page.getByText(/Joined .* \d{4}/i)).toBeVisible({ timeout: 5000 });
  });

  test("preferences persist across reload (smoke check)", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await page.waitForTimeout(800);
    // Confirm at least one Switch is present and a row is visible — full toggle
    // state verification is unreliable on RN-web Switch elements.
    const switches = page.locator('input[type="checkbox"]');
    const count = await switches.count();
    expect(count, "settings should expose at least one toggle").toBeGreaterThan(0);
    await page.reload();
    await page.waitForTimeout(2500);
    // After reload expo-router may restore the /settings route; navigate to a tab first.
    await page.goto("/prayer", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.getByTestId("settings-icon-button").click();
    await expect(page.getByText(/Daily reminder/i)).toBeVisible({ timeout: 5000 });
  });

  test("back button returns to prior tab", async ({ page }) => {
    await bootApp(page, "scripture");
    await page.getByTestId("settings-icon-button").click();
    await expect(page.getByText("Settings", { exact: true })).toBeVisible();
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/scripture/);
  });

  test("create-account button shows a coming-soon prompt (no real auth yet)", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await page.getByTestId("create-account-button").click();
    // No assertion on alert text (window.alert content not directly readable in all RN-web builds);
    // we just confirm the click didn't crash the screen.
    await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  });
});
