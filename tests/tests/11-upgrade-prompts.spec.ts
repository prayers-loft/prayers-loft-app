// 11 — Phase 1.5 upgrade prompts: dismissible, contextual, non-blocking.
import { expect, test } from "@playwright/test";
import { bootApp } from "./_helpers";

test.describe("@upgrade-prompts phase 1.5", () => {
  test("Settings 'Backup My Journey' opens the upgrade sheet with backup variant", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await page.getByTestId("create-account-button").click();
    await expect(page.getByTestId("upgrade-prompt-sheet")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("upgrade-prompt-title")).toHaveText(/Save your spiritual journey/i);
    await expect(page.getByTestId("upgrade-prompt-cta")).toHaveText(/Backup My Journey/);
    await expect(page.getByTestId("upgrade-prompt-dismiss")).toHaveText(/Not Now/);
  });

  test("Not Now dismisses the sheet cleanly", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await page.getByTestId("create-account-button").click();
    await expect(page.getByTestId("upgrade-prompt-sheet")).toBeVisible();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await page.getByTestId("upgrade-prompt-dismiss").click();
    await expect(page.getByTestId("upgrade-prompt-sheet")).toBeHidden({ timeout: 5000 });
  });

  test("CTA tap routes to coming-soon dialog without crashing", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("settings-icon-button").click();
    await page.getByTestId("create-account-button").click();
    await expect(page.getByTestId("upgrade-prompt-sheet")).toBeVisible();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await page.getByTestId("upgrade-prompt-cta").click();
    await expect(page.getByText(/Profile/)).toBeVisible({ timeout: 5000 });
  });
});
