// 00 — CI smoke gate.
//
// PURPOSE
// -------
// A small, fast, post-nav-refactor-stable spec set that the `smoke` GitHub
// Actions job runs on every PR and every push to main. This is the *required*
// gate; the much larger legacy suite (01-18) is run by the non-blocking
// `full` job until those specs are repaired in a follow-up PR.
//
// DESIGN RULES (keep this file fast and reliable)
// -----------------------------------------------
//   • Self-contained — does NOT import _helpers.ts, because _helpers'
//     `ROUTES` constant still references the removed `/reflections` route
//     and `bootApp` blocks waiting for that legacy shell.
//   • No LLM-bound assertions. The verse fast-path uses
//     include_devotional=false so the backend skips Claude entirely.
//   • No flaky timing waits. Auto-waiting locators + short networkidle.
//   • Each test should finish in well under 20s wall-clock; the whole file
//     runs in under 2 minutes serial, ~30-45s with workers=3.

import { expect, test } from "@playwright/test";

// Backend base URL. In CI the workflow sets EXPO_PUBLIC_BACKEND_URL to
// http://localhost:8001 (the FastAPI server) so Playwright API calls can
// reach the backend directly without going through the Expo dev server.
// Fall back to localhost:8001 for local runs.
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "http://localhost:8001";

// Mild splash settle. The cold-launch splash plays for ~2.2s on first render.
const SPLASH_SETTLE_MS = 2500;

test.describe.configure({ mode: "parallel" });

test.describe("@smoke CI gate", () => {
  test("app shell boots and the 3-tab bar is present", async ({ page }) => {
    await page.goto("/prayer", { waitUntil: "domcontentloaded" });
    // Wait for the bottom tab bar to mount — confirms the app shell rendered.
    await page.getByTestId("bottom-tab-bar").waitFor({ state: "attached", timeout: 30_000 });
    // After the nav refactor: Prayer / Scripture / Bible Assistant.
    await expect(page.getByTestId("tab-prayer")).toBeVisible();
    await expect(page.getByTestId("tab-scripture")).toBeVisible();
    await expect(page.getByTestId("tab-bible-assistant")).toBeVisible();
  });

  test("scripture tab renders the verse card (Phase-1 fast path)", async ({ page }) => {
    await page.goto("/scripture", { waitUntil: "domcontentloaded" });
    await page.getByTestId("bottom-tab-bar").waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForTimeout(SPLASH_SETTLE_MS);
    // The verse card is hydrated from the Phase-1 include_devotional=false
    // fetch, so it must appear quickly — well before any LLM call returns.
    await expect(page.getByTestId("verse-card")).toBeVisible({ timeout: 15_000 });
  });

  test("bible assistant tab opens and shows its prompt input", async ({ page }) => {
    await page.goto("/bible-assistant", { waitUntil: "domcontentloaded" });
    await page.getByTestId("bottom-tab-bar").waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForTimeout(SPLASH_SETTLE_MS);
    await expect(
      page.getByPlaceholder(/Ask any Bible question|devotional topic/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("read-only My Reflections (journal) route renders", async ({ page }) => {
    await page.goto("/reflections-history", { waitUntil: "domcontentloaded" });
    // Page-level header is plain text "My Reflections". Empty state is
    // also acceptable (test runs in a fresh CI database).
    await expect(
      page.getByText(/My Reflections/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("backend health endpoint returns ok", async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/health`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test("verse-only fast path returns under 2s with the structured-null shape", async ({ request }) => {
    const t0 = Date.now();
    const res = await request.get(`${BACKEND_URL}/api/daily-verse?include_devotional=false`);
    const elapsed = Date.now() - t0;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.verse).toBe("string");
    expect(body.verse.length).toBeGreaterThan(10);
    expect(typeof body.reference).toBe("string");
    expect(body.devotional).toBe("");
    expect(body.devotional_structured).toBeNull();
    // Fast path skips the LLM call entirely. Sub-2-second budget is generous;
    // a cache hit returns in ~10ms.
    expect(elapsed).toBeLessThan(2_000);
  });

  test("bible-assistant question endpoint accepts a request (smoke ping)", async ({ request }) => {
    // We intentionally do NOT assert on the LLM response body length or
    // semantics — only that the endpoint accepts a well-formed request and
    // returns a 200 with the contract fields. Keeps the smoke gate snappy
    // even when Claude is slow.
    const res = await request.post(`${BACKEND_URL}/api/bible-assistant`, {
      data: { mode: "question", input: "ping" },
      timeout: 30_000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.response).toBe("string");
    expect(body.mode).toBe("question");
    // Q&A mode has no structured payload.
    expect(body.response_structured).toBeNull();
  });
});
