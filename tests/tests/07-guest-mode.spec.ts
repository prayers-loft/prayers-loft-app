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

  test("no auth-related network requests are issued", async ({ page }) => {
    const seen: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (/\/(login|signin|signup|oauth|auth|token|session)\b/.test(u)) seen.push(u);
    });
    await bootApp(page, "prayer");
    await page.getByTestId("tab-scripture").click();
    await page.waitForTimeout(1500);
    expect(seen, `auth endpoints should never be called: ${seen.join(", ")}`).toEqual([]);
  });
});
