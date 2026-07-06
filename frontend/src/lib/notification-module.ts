// -----------------------------------------------------------------------------
// notification-module — the SINGLE guarded lazy loader for expo-notifications.
//
// WHY THIS FILE EXISTS
// --------------------
// On SDK 54 in Expo Go, `expo-notifications` cannot be loaded at all. Its
// module-level code runs `requireNativeModule('ExpoNotificationsEmitter')`
// SYNCHRONOUSLY during module initialization, and that call throws when
// the native module is not registered (i.e. every time you're running in
// Expo Go — Expo dropped notification support from Expo Go in SDK 53+).
//
// Wrapping `import("expo-notifications")` in a try/catch is NOT enough
// because:
//   1. Metro compiles `import()` to a require() inside a microtask. The
//      require() runs the module's top-level code synchronously; if that
//      code throws before returning from require(), the Promise still
//      rejects — which we can catch. So far, safe.
//   2. HOWEVER — if there are MULTIPLE call sites that each independently
//      trigger the lazy require, each one hits the same synchronous
//      module-init throw. Metro sees repeated invariant failures at
//      module load time and surfaces them via React Native's global
//      error handler (LogBox / RN's red-box), NOT via our promise chain.
//      Result: red-box on Expo Go even though our promise chain "would"
//      have caught it.
//
// The definitive fix: DO NOT ATTEMPT to load `expo-notifications` when
// running in Expo Go. Every notification-touching function goes through
// this helper. In Expo Go it returns null immediately with a single-shot
// warning; in TestFlight / dev-client builds it dynamic-imports the real
// module and caches it.
//
// USAGE CONTRACT
// --------------
// Every file that needs notifications MUST:
//   • Import `getNotificationModule` from THIS file (or a subset helper
//     defined below).
//   • Call it INSIDE an async function / effect (never at module scope).
//   • Handle the `null` return value as "notifications unavailable — no-op".
//
// Files that were audited and must not statically import expo-notifications:
//   src/hooks/use-notification-deep-link.ts    → uses this loader
//   src/lib/reminders.ts                        → uses this loader
//   app/_layout.tsx                             → does NOT init at module
//                                                  load; runs inside useEffect
//   app/settings.tsx                            → imports helpers only
//   src/components/NotificationPrimerSheet.tsx  → presentation-only, no imports
//   src/components/OnboardingCarousel.tsx       → imports helpers only
//   src/lib/onboarding.ts                       → imports helpers only
// -----------------------------------------------------------------------------

// Type-only import — erased at runtime, so Node-based unit tests that
// import this file will not attempt to load the native module. Kept at
// the top of the module so lint's import/first rule is happy.
import type * as NotificationsType from "expo-notifications";

// -----------------------------------------------------------------------------
// NODE COMPATIBILITY — no top-level `expo` import
// -----------------------------------------------------------------------------
// This file is imported by src/lib/reminders.ts, which is in turn imported
// by our Node-based Playwright unit tests. A top-level `import { ... } from
// "expo"` would fail to resolve under ts-node (the `expo` package is an
// RN-only barrel with `.native.js` variants that Node cannot load).
//
// So `isRunningInExpoGo` is loaded LAZILY inside a try/catch. In Node,
// the require throws → we treat that as "not Expo Go" (Node tests are
// definitely not Expo Go). In RN, the require succeeds and returns the
// real function.
// -----------------------------------------------------------------------------

/** Type of the `isRunningInExpoGo` symbol from the `expo` package. */
type IsRunningInExpoGoFn = () => boolean;

// Cached function handle. `null` until first resolution attempt; either
// the real function (RN) or a stub returning false (Node / web / dev
// build where the import failed).
let cachedIsRunningInExpoGo: IsRunningInExpoGoFn | null = null;
function resolveIsRunningInExpoGo(): IsRunningInExpoGoFn {
  if (cachedIsRunningInExpoGo) return cachedIsRunningInExpoGo;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo") as { isRunningInExpoGo?: IsRunningInExpoGoFn };
    if (typeof mod.isRunningInExpoGo === "function") {
      cachedIsRunningInExpoGo = mod.isRunningInExpoGo;
    } else {
      cachedIsRunningInExpoGo = () => false;
    }
  } catch {
    // Node unit-test env — `expo` package can't be loaded. Treat as
    // "definitely not Expo Go". Same behavior as web at runtime.
    cachedIsRunningInExpoGo = () => false;
  }
  return cachedIsRunningInExpoGo;
}


/** Return shape of {@link getNotificationModule}. `null` means "we're not
 *  going to touch native notifications on this runtime — proceed as if
 *  the module doesn't exist". */
export type NotificationsModule = typeof NotificationsType | null;

// Cached module handle. Populated on first successful load.
let cachedModule: NotificationsModule = null;

// In-flight promise guard — if two callers race into
// `getNotificationModule()` before the first has finished the dynamic
// import, they share the same promise instead of both re-entering the
// require path. Prevents duplicate `import() error` warns on web/dev
// preview where two independent effects (deep-link hook + foreground
// handler / permission probe) can call this on the same tick.
let inflightLoad: Promise<NotificationsModule> | null = null;

// Sticky failure flag. Once we've decided we can't load (Expo Go, or the
// dynamic import threw), we STOP trying. This prevents:
//   • Log spam on every re-render.
//   • Repeated synchronous native-module invariant failures that Metro
//     surfaces via the global error handler.
let loadState: "unknown" | "ok" | "unavailable" = "unknown";

// One-shot warn so the developer knows deep-link + scheduling are
// disabled for this session, without spamming every render.
let warningEmitted = false;
function warnOnce(reason: string): void {
  if (warningEmitted) return;
  warningEmitted = true;
  console.warn(
    `[notification-module] expo-notifications disabled for this session ` +
      `(${reason}). This is EXPECTED in Expo Go on SDK 53+. TestFlight / ` +
      `dev-client / production builds are unaffected.`,
  );
}

/** Fast, synchronous check — safe to call from any thread. Returns true
 *  when we KNOW notifications will never work on this runtime. Prefer
 *  this at call sites that need to bail early without waiting for a
 *  dynamic-import round trip. */
export function isNotificationRuntimeUnavailable(): boolean {
  // `isRunningInExpoGo()` from the `expo` package is a pure sync read of
  // a Constants.executionEnvironment shim. Cheap. Safe on all platforms.
  try {
    if (resolveIsRunningInExpoGo()()) return true;
  } catch {
    // If the check itself throws (unlikely — expo is always present),
    // treat as unavailable so we err on the side of "don't crash".
    return true;
  }
  return loadState === "unavailable";
}

/** Lazy-load `expo-notifications`, guarded by an Expo-Go gate and a
 *  sticky failure flag. Returns the module or `null`. NEVER THROWS.
 *
 *  This is the ONLY function in the app that should invoke
 *  `import("expo-notifications")`. Every other notification-touching
 *  helper must route through here so we have a single choke point for:
 *    • runtime detection (Expo Go vs TestFlight)
 *    • error containment
 *    • test-time mocking (Node unit tests never load the native module)
 */
export async function getNotificationModule(): Promise<NotificationsModule> {
  if (cachedModule) return cachedModule;
  if (loadState === "unavailable") return null;
  // Serialize concurrent callers so we only run the dynamic import ONCE
  // per session, even if two effects race to call this on the same tick.
  if (inflightLoad) return inflightLoad;

  inflightLoad = (async () => {
    // Hard gate: Expo Go can never load this module. Return early WITHOUT
    // attempting the import — the import itself would throw synchronously
    // during module init and produce the red-box crash.
    try {
      if (resolveIsRunningInExpoGo()()) {
        loadState = "unavailable";
        warnOnce("running in Expo Go");
        return null;
      }
    } catch {
      loadState = "unavailable";
      warnOnce("isRunningInExpoGo() threw");
      return null;
    }

    // Compiled builds path: try the lazy import. If ANYTHING goes wrong
    // (dev-client without notifications entitlement, permission entry
    // missing from Info.plist, etc.) we degrade to no-op instead of
    // crashing the render tree.
    try {
      const mod = (await import("expo-notifications")) as unknown as
        typeof NotificationsType;
      cachedModule = mod;
      loadState = "ok";
      return mod;
    } catch (err) {
      loadState = "unavailable";
      warnOnce("dynamic import failed");
      console.warn("[notification-module] import() error:", err);
      return null;
    }
  })();
  try {
    return await inflightLoad;
  } finally {
    inflightLoad = null;
  }
}

/** Best-effort platform check without pulling in `react-native` at the
 *  top of this file. `react-native` is cheap to require, but keeping this
 *  file free of top-level RN imports makes it fully importable from Node
 *  unit tests. */
export async function detectPlatformOS(): Promise<string> {
  try {
    const RN = await import("react-native");
    return RN.Platform.OS;
  } catch {
    return "web";
  }
}
