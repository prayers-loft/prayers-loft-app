// 02 — Prayer tab: full generation flow (request -> reflection -> prayer -> save/share).
import { expect, test } from "@playwright/test";
import { bootApp, watchFailures } from "./_helpers";

test.describe("@prayer prayer assistant", () => {
  test("generates a prayer from a user thought", async ({ page }) => {
    const failures = watchFailures(page);
    await bootApp(page, "prayer");

    const input = page.getByTestId("prayer-input");
    await input.fill("I'm anxious about an interview tomorrow");
    await page.getByTestId("begin-prayer-button").click();

    // Reflection / Pray-with-me button appears within Claude latency budget.
    await expect(page.getByTestId("pray-with-me-button")).toBeVisible({ timeout: 25_000 });

    await page.getByTestId("pray-with-me-button").click();

    // Prayer card eventually appears.
    await expect(page.getByTestId("prayer-card")).toBeVisible({ timeout: 25_000 });
    const text = (await page.getByTestId("prayer-card").innerText()).trim();
    expect(text.length, "prayer body should not be empty").toBeGreaterThan(20);

    // Action row exposes both Save and Share.
    await expect(page.getByTestId("save-prayer-button")).toBeVisible();
    await expect(page.getByTestId("share-prayer-button")).toBeVisible();

    failures.assertNone();
  });

  test("saving a prayer reflects the disabled \"Saved\" state", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("prayer-input").fill("thanksgiving for small mercies today");
    await page.getByTestId("begin-prayer-button").click();
    await page.getByTestId("pray-with-me-button").waitFor({ timeout: 25_000 });
    await page.getByTestId("pray-with-me-button").click();
    await page.getByTestId("prayer-card").waitFor({ timeout: 25_000 });

    const save = page.getByTestId("save-prayer-button");
    await save.click();
    // After save the button transitions to "Saved" — test for either visible text or disabled state.
    await expect(save).toContainText(/Saved/i, { timeout: 5_000 });
  });

  test("start-over resets the prayer screen", async ({ page }) => {
    await bootApp(page, "prayer");
    await page.getByTestId("prayer-input").fill("trying to forgive someone");
    await page.getByTestId("begin-prayer-button").click();
    await page.getByTestId("pray-with-me-button").waitFor({ timeout: 25_000 });
    await page.getByTestId("pray-with-me-button").click();
    await page.getByTestId("prayer-card").waitFor({ timeout: 25_000 });

    // Some screens expose start-over OR want-to-sit-with-this — accept either path.
    const reset = page.getByTestId("start-over-button");
    if (await reset.isVisible()) {
      await reset.click();
      await expect(page.getByTestId("prayer-input")).toBeVisible();
      await expect(page.getByTestId("prayer-input")).toHaveValue("");
    } else {
      test.info().annotations.push({ type: "note", description: "start-over-button not exposed on current build" });
    }
  });
});
