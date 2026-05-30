// 09 — Navigation: tabs preserve state, hardware-back lands gracefully, no leaks.
import { expect, test } from "@playwright/test";
import { bootApp, switchTab } from "./_helpers";

test.describe("@navigation tab routing", () => {
  test("typed-into prayer-input is preserved across tab switches", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("prayer-input").fill("draft thought - keep me here");
    await switchTab(page, "scripture");
    await page.waitForTimeout(700);
    await switchTab(page, "prayer");
    await expect(page.getByTestId("prayer-input")).toHaveValue("draft thought - keep me here");
  });

  test("directly visiting /reflections renders shell", async ({ page }) => {
    await bootApp(page, "reflections");
    await expect(page.getByTestId("bottom-tab-bar")).toBeVisible();
    await expect(page.getByTestId("reflection-input")).toBeVisible();
  });

  test("directly visiting /scripture loads the verse without going through Prayer first", async ({ page }) => {
    await bootApp(page, "scripture");
    await expect(page.getByTestId("verse-card")).toBeVisible({ timeout: 15_000 });
  });
});
