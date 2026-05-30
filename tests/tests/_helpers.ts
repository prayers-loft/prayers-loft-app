// Shared helpers for every spec in this suite.
//
// Design notes:
//   - Captures console.error + pageerror + failed /api requests as TEST
//     failures by default, so any silent JS regression bricks the build.
//   - Allow-lists noisy dev warnings we can't fix (e.g. expo-keyboard SDK pin
//     mismatch, RN Web pointerEvents deprecation already tracked).
//   - `bootApp()` performs a clean app boot and waits past the cold-launch
//     splash overlay so individual specs don't need to repeat that.
import { Page, expect, test } from "@playwright/test";

export const ROUTES = {
  prayer: "/prayer",
  scripture: "/scripture",
  reflections: "/reflections",
} as const;

const CONSOLE_ALLOWLIST: RegExp[] = [
  /useNativeDriver/i,
  /props\.pointerEvents is deprecated/i,
  /expo-audio.*not supported/i,
  /Animated:.*native animated module is missing/i,
  /react-native-keyboard-controller.*version mismatch/i,
  /Download the React DevTools/i,
  /Running application "main"/i,
  /pixabay\.com/i, // ambient audio cdn 403s are expected in CI
  /Failed to load resource:.*pixabay/i,
  /Failed to load resource: the server responded with a status of 403/i, // ambient audio cdn (URL not always inlined)
  /shadow\*/i,
  /textShadow\*/i,
  /style.pointerEvents/i,
  /SVG: TestID not supported/i,
  /Constants\.platform\.ios\.model has been deprecated/i,
  /Setting a timer for a long period of time/i,
  // Phase 2 auth: guest bootstrap calls /api/auth/me without a token and
  // intentionally receives 401. This is the only way the app knows it's a
  // guest on cold launch — it's expected, not an app failure.
  /Failed to load resource: the server responded with a status of 401/i,
  // Cloudflare beacon (CDN telemetry) hits a CORS preflight in the preview
  // gateway. It is environment noise that has nothing to do with the app.
  // The console line strips the URL; we see `net::ERR_FAILED` only.
  /cloudflareinsights\.com/i,
  /Failed to load resource: net::ERR_FAILED/i,
];

const NETWORK_ALLOWLIST: RegExp[] = [
  /pixabay\.com/i,
  /\/_expo\//i,
  /metro/i,
  /sockjs/i,
  /favicon/i,
  /hot-update/i,
  // Cloudflare beacon CORS preflight failure in preview gateway.
  /cloudflareinsights\.com/i,
];

export type FailureCollector = {
  consoleErrors: string[];
  pageErrors: string[];
  networkErrors: string[];
  assertNone(): void;
};

/**
 * Install global watchers on a Page that aggregate console errors, page
 * (unhandled) errors, and failed network requests.
 */
export function watchFailures(page: Page): FailureCollector {
  const out: FailureCollector = {
    consoleErrors: [],
    pageErrors: [],
    networkErrors: [],
    assertNone() {
      const all = [
        ...out.consoleErrors.map((m) => `console: ${m}`),
        ...out.pageErrors.map((m) => `pageerror: ${m}`),
        ...out.networkErrors.map((m) => `network: ${m}`),
      ];
      expect(
        all,
        `Detected failures while running test:\n  - ${all.join("\n  - ")}`
      ).toEqual([]);
    },
  };

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (CONSOLE_ALLOWLIST.some((rx) => rx.test(text))) return;
    out.consoleErrors.push(text);
  });

  page.on("pageerror", (err) => {
    out.pageErrors.push(err.message);
  });

  page.on("requestfailed", (req) => {
    const url = req.url();
    if (NETWORK_ALLOWLIST.some((rx) => rx.test(url))) return;
    const failure = req.failure();
    out.networkErrors.push(`${req.method()} ${url} -> ${failure?.errorText ?? "unknown"}`);
  });

  page.on("response", (resp) => {
    const url = resp.url();
    if (NETWORK_ALLOWLIST.some((rx) => rx.test(url))) return;
    if (!url.includes("/api/")) return;
    if (resp.status() >= 500) {
      out.networkErrors.push(`${resp.request().method()} ${url} -> ${resp.status()}`);
    }
  });

  return out;
}

/**
 * Boot the app to a given route, waiting past the splash overlay.
 * Splash plays for ~2.2s on cold launch; we wait for the bottom tab bar to
 * be present + interactive before returning.
 */
export async function bootApp(page: Page, route: keyof typeof ROUTES = "prayer") {
  await page.goto(ROUTES[route], { waitUntil: "domcontentloaded" });
  // Wait for bottom tab bar -> app shell is up.
  await page.getByTestId("bottom-tab-bar").waitFor({ state: "attached", timeout: 30_000 });
  // Soft-wait for the cold-launch splash to fade if it ran.
  await page.waitForTimeout(2400);
}

export async function switchTab(page: Page, tab: keyof typeof ROUTES) {
  await page.getByTestId(`tab-${tab}`).click();
  await page.waitForTimeout(350);
}

export function attachFailureWatcher() {
  // Convenience: call from test.beforeEach to wire up + auto-assert in afterEach.
  let collector: FailureCollector | null = null;
  test.beforeEach(async ({ page }) => {
    collector = watchFailures(page);
  });
  test.afterEach(async () => {
    if (collector) collector.assertNone();
  });
}
