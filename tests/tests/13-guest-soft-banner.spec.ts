// 13 — GuestSoftBanner: visibility, CTA → upgrade sheet, dismiss persistence.
import { expect, test } from "@playwright/test";
import { bootApp } from "./_helpers";

test.describe("@guest-banner phase 1.5", () => {
  test("Banner appears on Prayer tab, CTA opens upgrade sheet (backup variant)", async ({ page }) => {
    // Fresh state: clear storage so the banner is unsuppressed.
    await page.goto("/prayer", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());
    await bootApp(page, "prayer");

    const banner = page.getByTestId("guest-soft-banner");
    await expect(banner).toBeVisible({ timeout: 5000 });

    await page.getByTestId("guest-soft-banner-cta").click();
    await expect(page.getByTestId("upgrade-prompt-sheet")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("upgrade-prompt-title")).toHaveText(/Save your spiritual journey/i);

    // Clean up: dismiss the sheet so it doesn't bleed into other tests.
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await page.getByTestId("upgrade-prompt-dismiss").click();
    await expect(page.getByTestId("upgrade-prompt-sheet")).toBeHidden({ timeout: 5000 });
  });

  test("Banner dismiss persists across reloads (14-day suppression)", async ({ page }) => {
    await page.goto("/prayer", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());
    await bootApp(page, "prayer");

    const banner = page.getByTestId("guest-soft-banner");
    await expect(banner).toBeVisible();
    await page.getByTestId("guest-soft-banner-dismiss").click();
    await expect(banner).toBeHidden({ timeout: 5000 });

    // Reload — banner must remain hidden because dismissal timestamp persisted.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("bottom-tab-bar").waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForTimeout(2400);
    await expect(page.getByTestId("guest-soft-banner")).toHaveCount(0);
  });
});
