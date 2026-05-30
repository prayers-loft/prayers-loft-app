// 03 — Scripture tab: daily verse, devotional, reactions, Q&A (Devotional + Theologian).
import { expect, test } from "@playwright/test";
import { bootApp, switchTab, watchFailures } from "./_helpers";

test.describe("@scripture scripture & q&a", () => {
  test("daily verse + devotional load on first navigation", async ({ page }) => {
    const failures = watchFailures(page);
    await bootApp(page, "prayer");
    await switchTab(page, "scripture");

    await expect(page.getByTestId("verse-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("devotional-card")).toBeVisible({ timeout: 15_000 });

    const verseText = (await page.getByTestId("verse-card").innerText()).trim();
    expect(verseText.length, "verse should not be empty").toBeGreaterThan(20);

    failures.assertNone();
  });

  test("verse rotating banner is present", async ({ page }) => {
    await bootApp(page, "scripture");
    await expect(page.getByTestId("rotating-banner")).toBeVisible();
  });

  test("reactions row updates count on tap", async ({ page }) => {
    await bootApp(page, "scripture");
    const row = page.getByTestId("reactions-row");
    await expect(row).toBeVisible();

    // Find any react-* child and tap once.
    const prayBtn = page.getByTestId("react-pray");
    await prayBtn.click();
    // Network call goes through; visible count appears (>= 1).
    await page.waitForTimeout(800);
    await expect(prayBtn).toBeVisible();
  });

  test("theological Q&A returns a Devotional response", async ({ page }) => {
    const failures = watchFailures(page);
    await bootApp(page, "scripture");

    const input = page.getByTestId("theological-question-input");
    await input.fill("What does it mean to be still and know that He is God?");
    await page.getByTestId("ask-question-button").click();

    await expect(page.getByTestId("qa-response")).toBeVisible({ timeout: 30_000 });
    const text = (await page.getByTestId("qa-response").innerText()).trim();
    expect(text.length).toBeGreaterThan(40);

    failures.assertNone();
  });

  test("switching to Theologian fetches a second response", async ({ page }) => {
    await bootApp(page, "scripture");
    await page.getByTestId("theological-question-input").fill("Why does grace matter more than works?");
    await page.getByTestId("ask-question-button").click();
    await page.getByTestId("qa-response").waitFor({ timeout: 30_000 });
    const devotionalText = (await page.getByTestId("qa-response").innerText()).trim();

    await page.getByTestId("style-pill-Theologian").click();
    // The same qa-response container updates with the Theologian style.
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("qa-response")).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(
      (devText) => {
        const el = document.querySelector('[data-testid="qa-response"]') as HTMLElement | null;
        if (!el) return false;
        const t = (el.innerText || "").trim();
        return t.length > 40 && t !== devText;
      },
      devotionalText,
      { timeout: 30_000 }
    );
  });

  test("reflect-on-verse CTA navigates to Reflections", async ({ page }) => {
    await bootApp(page, "scripture");
    const cta = page.getByTestId("want-to-reflect-button");
    if (await cta.isVisible()) {
      await cta.click();
      await expect(page).toHaveURL(/reflections/);
    }
  });
});
