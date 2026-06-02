// 16 — TestFlight readiness bundle: Privacy + Terms screens, suggestion
// chips, AI-disclosure presence, Delete-Account row gating, Theologian rename.
import { expect, test } from "@playwright/test";
import { bootApp } from "./_helpers";

test.describe("@testflight-bundle", () => {
  test("Privacy + Terms screens are reachable from Settings → About", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await page.waitForTimeout(500);
    await page.getByTestId("open-privacy").click();
    await expect(page.getByTestId("privacy-scroll")).toBeVisible({ timeout: 4000 });
    await page.getByTestId("privacy-back").click();
    await page.waitForTimeout(400);
    await page.getByTestId("open-terms").click();
    await expect(page.getByTestId("terms-scroll")).toBeVisible({ timeout: 4000 });
  });

  test("Prayer suggestion chips render and fill the input", async ({ page }) => {
    await bootApp(page, "prayer");
    const chips = page.getByTestId("prayer-prompt-chips");
    await expect(chips).toBeVisible();
    await expect(page.getByTestId("prayer-privacy-note")).toHaveText(/Your prayers are private/i);
    const chipButtons = page.locator('[data-testid^="prayer-chip-"]');
    await expect(chipButtons.first()).toBeVisible();
    const chipText = await chipButtons.first().innerText();
    await chipButtons.first().click();
    await page.waitForTimeout(300);
    const input = page.getByTestId("prayer-input");
    await expect(input).toHaveValue(new RegExp(chipText.split(/\s+/)[0], "i"));
  });

  test("Auth sheet exposes Terms + Privacy links + Delete Account row gated to signed-in", async ({ page }) => {
    await page.goto("/prayer", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.removeItem("prayersloft_auth_v1"));
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await page.waitForTimeout(400);
    // Guest: Delete Account must NOT be visible
    await expect(page.getByTestId("delete-account-button")).toHaveCount(0);
    await page.getByTestId("create-account-button").click();
    await page.waitForTimeout(400);
    await page.getByTestId("upgrade-prompt-cta").click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("auth-terms-link")).toBeVisible();
    await expect(page.getByTestId("auth-privacy-link")).toBeVisible();
  });

  test("Theologian label renamed to 'Bible Questions' in Scripture tab", async ({ page }) => {
    await bootApp(page, "scripture");
    // The internal testID stays as 'style-pill-Theologian'; only the visible label changed.
    const pill = page.getByTestId("style-pill-Theologian");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText(/Bible Questions/i);
  });
});
