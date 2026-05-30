// 01 — Smoke: the app boots, shows the splash, lands on Prayer, all three
//             tabs are reachable, no console / network errors along the way.
import { expect, test } from "@playwright/test";
import { bootApp, switchTab, watchFailures, ROUTES } from "./_helpers";

test.describe("@smoke shell", () => {
  test("cold launch reaches Prayer tab and renders shell", async ({ page }) => {
    const failures = watchFailures(page);
    await bootApp(page, "prayer");

    await expect(page.getByTestId("bottom-tab-bar")).toBeVisible();
    await expect(page.getByTestId("prayer-input")).toBeVisible();
    await expect(page.getByTestId("begin-prayer-button")).toBeVisible();

    failures.assertNone();
  });

  test("all three tabs are present and navigable", async ({ page }) => {
    const failures = watchFailures(page);
    await bootApp(page, "prayer");

    for (const tab of ["scripture", "reflections", "prayer"] as const) {
      await switchTab(page, tab);
      await expect(page).toHaveURL(new RegExp(ROUTES[tab].replace("/", "\\/")));
    }

    failures.assertNone();
  });

  test("tab labels are present in DOM", async ({ page }) => {
    await bootApp(page, "prayer");
    // Read innerText via JS since RN Web's <Text> nodes are unusual under toContainText.
    const text = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="bottom-tab-bar"]');
      return (bar as HTMLElement | null)?.innerText || "";
    });
    expect(text).toContain("PRAYER");
    expect(text).toContain("SCRIPTURE");
    expect(text).toContain("REFLECTIONS");
  });
});
