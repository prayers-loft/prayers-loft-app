/**
 * Automated regression test for the Walk back-button.
 *
 * Design principle: Back represents user intent. It should leave immediately
 * unless leaving would interrupt something the user is actively watching
 * (i.e. the assistant is currently streaming). This test asserts:
 *
 *   1. idle           — session just opened, only the assistant opener
 *   2. after messages — user has sent turns; assistant is idle
 *   3. streaming      — assistant reply arriving mid-stream (native shows a
 *                       confirmation dialog; web skips it and navigates)
 *   4. ended panel    — extraction review UI visible
 *
 * Each case asserts the user is back on the Walk landing (walk-hero
 * visible) within 3 seconds of pressing the back control.
 *
 * Run: BASE=http://localhost:3000 npx playwright test tests/tests/walk-back-button.spec.ts
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.BASE || "http://localhost:3000";
const NAV_DEADLINE_MS = 3000;

async function goToWalk(page: any) {
  await page.goto(`${BASE}/walk`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      !!document.querySelector("#root") &&
      (document.querySelector("#root") as HTMLElement).innerText.length > 0,
    null,
    { timeout: 25000 },
  );
  await page.waitForTimeout(2000);
}

test.describe("Walk back button", () => {
  test("idle state: instant return to landing", async ({ page }) => {
    await goToWalk(page);
    await page.getByTestId("walk-begin-checkin").click();
    await page.getByTestId("walk-input").waitFor({ timeout: 20000 });
    const t0 = Date.now();
    await page.getByTestId("walk-close").click();
    await page.getByTestId("walk-hero").waitFor({ timeout: NAV_DEADLINE_MS });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(NAV_DEADLINE_MS);
  });

  test("streaming state: back does not wait for the reply to finish", async ({
    page,
  }) => {
    await goToWalk(page);
    await page.getByTestId("walk-begin-checkin").click();
    await page.getByTestId("walk-input").waitFor({ timeout: 20000 });
    await page
      .getByTestId("walk-input")
      .fill("Tell me a lot about faith — I want a long response.");
    await page.getByTestId("walk-send").click();
    // Wait until the "Listening…" indicator or any streamed content appears
    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return (
          t.includes("Listening") || t.length > 400 || t.toLowerCase().includes("faith")
        );
      },
      null,
      { timeout: 15000 },
    );
    const t0 = Date.now();
    await page.getByTestId("walk-close").click();
    // On web the confirm dialog is skipped so we should be on the landing
    // page essentially immediately.
    await page.getByTestId("walk-hero").waitFor({ timeout: NAV_DEADLINE_MS });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(NAV_DEADLINE_MS);
  });

  test("after messages, idle: back leaves without a confirmation dialog", async ({
    page,
  }) => {
    // The user has sent turns but the assistant is idle — new spec says
    // this must navigate immediately, no dialog. Only actively streaming
    // should ever prompt the user.
    await goToWalk(page);
    await page.getByTestId("walk-begin-checkin").click();
    await page.getByTestId("walk-input").waitFor({ timeout: 20000 });
    await page.getByTestId("walk-input").fill("I'm grateful today.");
    await page.getByTestId("walk-send").click();
    // Wait for the send button to re-enable (stream complete → assistant idle).
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="walk-send"]',
        ) as HTMLElement | null;
        if (!el) return false;
        const disabled =
          el.getAttribute("aria-disabled") === "true" ||
          (el as HTMLButtonElement).disabled === true;
        return !disabled;
      },
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(500);
    const t0 = Date.now();
    await page.getByTestId("walk-close").click();
    await page.getByTestId("walk-hero").waitFor({ timeout: NAV_DEADLINE_MS });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(NAV_DEADLINE_MS);
  });

  test("ended state: back from the extraction-review panel", async ({ page }) => {
    await goToWalk(page);
    await page.getByTestId("walk-begin-checkin").click();
    await page.getByTestId("walk-input").waitFor({ timeout: 20000 });
    await page.getByTestId("walk-input").fill("I'm grateful today.");
    await page.getByTestId("walk-send").click();
    // Wait for the send button to re-enable (stream complete).
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="walk-send"]',
        ) as HTMLElement | null;
        if (!el) return false;
        const disabled =
          el.getAttribute("aria-disabled") === "true" ||
          (el as HTMLButtonElement).disabled === true;
        return !disabled;
      },
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(1000);
    await page.getByTestId("walk-close-session").click();
    await page.getByTestId("walk-ended-panel").waitFor({ timeout: 30000 });
    const t0 = Date.now();
    await page.getByTestId("walk-close").click();
    await page.getByTestId("walk-hero").waitFor({ timeout: NAV_DEADLINE_MS });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(NAV_DEADLINE_MS);
  });
});
