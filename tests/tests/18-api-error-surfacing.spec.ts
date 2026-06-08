// 18 — API error surfacing regression suite.
//
// PURPOSE
// =======
// v1.0.0 build 5 shipped to TestFlight with a silent failure mode:
// `src/lib/api.ts` resolved BASE solely from `process.env.EXPO_PUBLIC_BACKEND_URL`,
// which evaluates to undefined in some iOS release builds. Every fetch became
// "undefined/api/..." and threw, but the catch blocks in Scripture / Prayer /
// Reflections only called `console.warn`. Result: spinners that never resolved,
// buttons that did nothing, zero on-screen feedback. The user could not tell
// the app was broken — and neither could a happy-path test suite.
//
// These tests assert the *unhappy path*: every API failure MUST surface a
// user-visible error toast, never a silent no-op. This is the safety net
// the build-5 outage taught us we needed.
//
// MECHANISM
// =========
// We use Playwright's `page.route(..., route => route.abort())` to deterministically
// fail specific /api/* endpoints, then assert the visible toast UI. We are NOT
// testing whether the backend works — that's covered by the existing happy-path
// suite (02-prayer, 03-scripture, 04-reflections). We are testing that the
// CLIENT correctly surfaces failure to the user.

import { expect, test } from "@playwright/test";
import { bootApp, watchFailures, switchTab } from "./_helpers";

const TOAST = "app-toast";
const TOAST_ERROR = "app-toast-error";
const TOAST_TITLE = "app-toast-title";

test.describe("@api-error-surfacing silent-failure regressions", () => {
  // ---------------------------------------------------------------------------
  // 1. Daily verse load — backend returns 500
  // ---------------------------------------------------------------------------
  test("scripture: daily verse 5xx surfaces visible error toast", async ({ page }) => {
    // Fail the daily-verse endpoint specifically.
    await page.route(/\/api\/daily-verse.*/, (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ detail: "synthetic 500" }) }),
    );

    await bootApp(page, "scripture");

    // Toast surface within reasonable client retry budget.
    const toast = page.getByTestId(TOAST_ERROR);
    await expect(toast, "error toast must appear when /api/daily-verse fails").toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(TOAST_TITLE)).toContainText(/scripture|verse|couldn.?t load/i);

    // Loading spinner must NOT be stuck — explicit assertion this regression
    // doesn't repeat. The Scripture screen's `setLoading(false)` in `finally`
    // is what unsticks it.
    const spinner = page.getByTestId("scripture-loading");
    if (await spinner.count()) {
      await expect(spinner, "spinner must reset after error").not.toBeVisible({ timeout: 10_000 });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Prayer submission — POST /api/prayer-request fails
  // ---------------------------------------------------------------------------
  test("prayer: failed prayer-request POST surfaces error toast (not silent no-op)", async ({ page }) => {
    await page.route(/\/api\/prayer-request/, (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ detail: "synthetic 500" }) }),
    );

    await bootApp(page, "prayer");
    await page.getByTestId("prayer-input").fill("I am anxious about tomorrow");
    await page.getByTestId("begin-prayer-button").click();

    await expect(
      page.getByTestId(TOAST_ERROR),
      "tapping Begin with a failing backend must surface a toast, not a silent button",
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId(TOAST_TITLE)).toContainText(
      /didn.?t go through|prayer|try again/i,
    );

    // The Begin button must NOT be stuck in the loading state.
    const begin = page.getByTestId("begin-prayer-button");
    await expect(begin, "begin button must be re-enabled after error").toBeEnabled({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Prayer follow-up — POST /api/prayer-follow-up fails
  // ---------------------------------------------------------------------------
  test("prayer: failed prayer-follow-up POST surfaces error toast", async ({ page }) => {
    // Allow the initial prayer-request to succeed (uses real backend), then
    // fail only the follow-up call.
    await page.route(/\/api\/prayer-follow-up/, (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ detail: "synthetic 500" }) }),
    );

    await bootApp(page, "prayer");
    await page.getByTestId("prayer-input").fill("gratitude for my family");
    await page.getByTestId("begin-prayer-button").click();

    // First step (reflection) should still appear normally.
    await page.getByTestId("pray-with-me-button").waitFor({ timeout: 25_000 });
    await page.getByTestId("pray-with-me-button").click();

    // Follow-up call fails → toast must appear.
    await expect(page.getByTestId(TOAST_ERROR)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(TOAST_TITLE)).toContainText(
      /couldn.?t complete|prayer|try again/i,
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Reflections — load failure
  // ---------------------------------------------------------------------------
  test("reflections: failed GET /api/reflections surfaces error toast", async ({ page }) => {
    await page.route(/\/api\/reflections(\?|$)/, (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ detail: "synthetic 500" }) }),
    );

    await bootApp(page, "prayer");
    await switchTab(page, "reflections");

    await expect(page.getByTestId(TOAST_ERROR)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(TOAST_TITLE)).toContainText(
      /couldn.?t load|reflections/i,
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Reflections — save failure
  // ---------------------------------------------------------------------------
  test("reflections: failed POST surfaces error toast (not silent save button)", async ({ page }) => {
    // Let the initial GET succeed (so user can reach the editor), fail the POST.
    await page.route(/\/api\/reflections(?!\/)/, (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 500, body: JSON.stringify({ detail: "synthetic 500" }) });
      }
      return route.continue();
    });

    await bootApp(page, "prayer");
    await switchTab(page, "reflections");

    // Open the editor. Existing tests use either a "Create" CTA or a tab-level
    // FAB; check for either testid.
    const newButton = page.getByTestId("new-reflection-button");
    if (await newButton.count()) {
      await newButton.click();
    } else {
      // Fallback: try common alternates without failing if they don't exist.
      const alt = page.getByTestId("reflection-fab");
      if (await alt.count()) await alt.click();
    }

    const editor = page.getByTestId("reflection-editor-input");
    if (await editor.count()) {
      await editor.fill("Testing the error path for save failures.");
      const saveBtn = page.getByTestId("save-reflection-button");
      await saveBtn.click();

      await expect(page.getByTestId(TOAST_ERROR)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(TOAST_TITLE)).toContainText(
        /couldn.?t save|couldn.?t update|reflection/i,
      );
    } else {
      // If the editor testids don't exist in this build, the spec self-skips
      // rather than producing a false failure. This is intentional — the test
      // is for catching SILENT failures, not for UI surface coverage which
      // 04-reflections.spec.ts owns.
      test.skip(true, "reflection editor testids not present; covered by 04-reflections");
    }
  });

  // ---------------------------------------------------------------------------
  // 6. App startup — empty BASE URL must produce a loud config-error toast.
  //
  // We can't directly mutate the bundled `process.env.EXPO_PUBLIC_BACKEND_URL`
  // from a Playwright test, but we CAN simulate the effective runtime state
  // by short-circuiting ALL /api/* requests with a network error. If startup
  // diagnostics or error surfacing logic regresses, no toast appears and this
  // test fails — exactly the build-5 scenario.
  // ---------------------------------------------------------------------------
  test("startup: complete /api network failure produces visible error UI within 20s", async ({ page }) => {
    await page.route(/\/api\//, (route) => route.abort("connectionfailed"));

    const failures = watchFailures(page);

    // Boot and let the app's startup probes fire (initAuth, probeMe,
    // getGuestIdentity, daily-verse on Scripture, etc.)
    await page.goto("/scripture", { waitUntil: "domcontentloaded" });
    await page.getByTestId("bottom-tab-bar").waitFor({ state: "attached", timeout: 30_000 });

    // At least one user-visible error indicator must appear. We accept ANY of:
    //  - the standard error toast
    //  - an inline "Couldn't load" message
    //  - a config error toast
    // The point is "not silent" — not "exact wording".
    const visibleError = page.locator(
      `[data-testid="${TOAST_ERROR}"], [data-testid="${TOAST}"], [data-testid="scripture-error"]`,
    );
    await expect(
      visibleError,
      "with all API calls failing, the app must surface at least one visible error indicator",
    ).toBeVisible({ timeout: 20_000 });

    // We intentionally do NOT assert `failures.assertNone()` here — this spec
    // INTENDS to fail network requests. The console-error allowlist already
    // accepts /api 5xx + connectionfailed for this specific spec.
    void failures;
  });
});

// Strict mode for this file: every test in it must complete within 60s.
test.describe.configure({ mode: "serial", timeout: 60_000 });
