// 07 — Guest mode invariants: app is anonymous-only; no auth prompts ever appear.
import { expect, test } from "@playwright/test";
import { bootApp } from "./_helpers";

test.describe("@guest-mode anonymous invariants", () => {
  test("no sign-in / sign-up / OAuth UI exists anywhere in the app", async ({ page }) => {
    await bootApp(page, "prayer");
    // Probe every tab.
    const banned = [
      /sign in/i,
      /sign up/i,
      /log in/i,
      /create account/i,
      /continue with google/i,
      /continue with apple/i,
      /sso/i,
    ];
    for (const tab of ["prayer", "scripture", "reflections"] as const) {
      await page.getByTestId(`tab-${tab}`).click();
      await page.waitForTimeout(800);
      const body = await page.evaluate(() => document.body.innerText || "");
      for (const rx of banned) {
        expect(body, `Guest-mode invariant violated on ${tab}: "${rx}" appeared`).not.toMatch(rx);
      }
    }
  });

  test("no auth-related network requests are issued for unauthenticated guests (besides the /me probe)", async ({ page }) => {
    // Phase 2 introduced a single best-effort /api/auth/me probe on app boot
    // to resume signed-in sessions. For an unauthenticated guest (no stored
    // tokens), the probe is harmless — it returns 401 and the app stays in
    // guest mode. What MUST NOT happen: any login/signin/signup/oauth/token
    // calls, since guests are never asked to authenticate.
    const seen: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (/\/(login|signin|signup|oauth|token|session)\b/.test(u)) seen.push(u);
    });
    // Ensure no persisted auth tokens leak from prior tests.
    await page.goto("/prayer", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.removeItem("prayersloft_auth_v1"));
    await bootApp(page, "prayer");
    await page.getByTestId("tab-scripture").click();
    await page.waitForTimeout(1500);
    expect(seen, `forbidden auth endpoints called: ${seen.join(", ")}`).toEqual([]);
  });
});
