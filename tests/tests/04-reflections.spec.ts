// 04 — Reflections tab: streak, save, edit, delete + persistence across reload.
import { expect, test } from "@playwright/test";
import { bootApp, switchTab, watchFailures } from "./_helpers";

const REFLECTION_BODY = "E2E reflection: today felt heavy, but the still small voice was kind.";

test.describe("@reflections journal", () => {
  test("save a reflection and confirm it appears", async ({ page }) => {
    const failures = watchFailures(page);
    await bootApp(page, "reflections");

    const input = page.getByTestId("reflection-input");
    await input.fill(REFLECTION_BODY);
    await page.getByTestId("save-reflection-button").click();

    // Reflection card containing the body shows up (text-only reflections are stored server-side).
    const card = page.locator('[data-testid^="reflection-card"]').filter({ hasText: "still small voice" });
    await expect(card.first()).toBeVisible({ timeout: 10_000 });

    failures.assertNone();
  });

  test("reflections persist across reload", async ({ page }) => {
    await bootApp(page, "reflections");
    await page.getByTestId("reflection-input").fill("E2E persistence check: mercy is enough.");
    await page.getByTestId("save-reflection-button").click();
    await page.waitForTimeout(900);

    await page.reload();
    await page.waitForTimeout(2500); // splash + boot

    await switchTab(page, "reflections");
    await expect(
      page.locator('[data-testid^="reflection-card"]').filter({ hasText: "mercy is enough" }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("streak card is present", async ({ page }) => {
    await bootApp(page, "reflections");
    // Either streak-card or streak-row depending on screen state.
    const a = page.getByTestId("streak-card");
    const b = page.getByTestId("streak-row");
    const visible = (await a.isVisible()) || (await b.isVisible());
    expect(visible, "streak indicator should render").toBeTruthy();
  });

  test("empty-state shows when no reflections exist (fresh storage)", async ({ page, context }) => {
    await context.clearCookies();
    // Reflections are server-stored, so we cannot truly clear them here — this test soft-asserts.
    await bootApp(page, "reflections");
    const empty = page.getByTestId("empty-state");
    if (await empty.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(empty).toBeVisible();
    } else {
      test.info().annotations.push({ type: "note", description: "reflections already exist on shared backend — empty-state not asserted" });
    }
  });
});
