// -----------------------------------------------------------------------------
// useNotificationDeepLink — routes daily-reminder taps to Scripture.
//
// Wire it once at the app root (below expo-router's Stack so the router is
// available). The hook handles three launch paths:
//
//   1. Cold launch — app was killed and the user tapped the reminder to
//      start it. We read Notifications.getLastNotificationResponseAsync()
//      exactly once (guarded by a module-level flag) and route.
//   2. Warm background — app was suspended and the user tapped the
//      reminder to bring it forward. addNotificationResponseReceivedListener
//      fires; we route on that event.
//   3. Foreground — reminder banner drops down while the app is open;
//      the same listener fires when the user taps the banner.
//
// Normal launches (app icon tap, deep link, share extension, etc.) are
// unaffected because the guard checks for our own `kind: 'daily-reminder'`
// payload — anything else is left alone.
//
// -----------------------------------------------------------------------------
// EXPO-GO COMPATIBILITY — lazy import of `expo-notifications`
// -----------------------------------------------------------------------------
// A previous version of this file did `import * as Notifications from
// "expo-notifications"` at the top level. On SDK 54 that pulls in a native
// module reference that Expo Go's runtime does not expose the same way as
// a compiled dev/production build, and imports transitively touched
// `PushNotificationIOS` — which is not registered in Expo Go's native
// bridge. Result: the app crashed on startup in Expo Go with
// "Your JavaScript code tried to access a native module that doesn't exist."
//
// Fix: load `expo-notifications` lazily inside the effect and wrap every
// call in try/catch. On TestFlight (compiled binary) the dynamic import
// resolves normally and behavior is identical to before. On Expo Go — or
// on any future runtime where the module can't be loaded — we no-op
// cleanly and the rest of the app runs.
// -----------------------------------------------------------------------------
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { routeFromResponse } from "@/src/lib/reminders";

let coldLaunchHandled = false;

// Cached module handle so the second render of the hook (StrictMode /
// hot reload) doesn't re-import the whole native module.
//
let cachedNotifications: any | null = null;
// Sticky "we already know it doesn't work here" flag. Prevents spamming
// dynamic-import + warn on every hook re-run in Expo Go.
let notificationsUnavailable = false;

async function loadNotifications(): Promise<any | null> {
  if (cachedNotifications) return cachedNotifications;
  if (notificationsUnavailable) return null;
  try {
    const mod = await import("expo-notifications");
    cachedNotifications = mod;
    return mod;
  } catch (err) {
    // First-time failure — record so we don't retry forever.
    notificationsUnavailable = true;
    console.warn(
      "[reminders] expo-notifications module unavailable — reminder deep-link " +
        "disabled for this session (expected in Expo Go on SDK 54+). " +
        "TestFlight/dev builds are unaffected.",
      err,
    );
    return null;
  }
}

export function useNotificationDeepLink(): void {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    (async () => {
      const Notifications = await loadNotifications();
      if (!Notifications || cancelled) return;

      // ---- Cold-launch path ------------------------------------------------
      // getLastNotificationResponseAsync() returns the response that launched
      // the app, or null if the app was launched normally. We resolve it once
      // per session; the module-level guard prevents re-triggering across
      // hot reloads (which would re-route the user mid-session).
      if (!coldLaunchHandled) {
        coldLaunchHandled = true;
        try {
          const response =
            await Notifications.getLastNotificationResponseAsync();
          if (cancelled) return;
          const route = routeFromResponse(response);
          if (route) {
            // Use replace() so the initial "/" screen doesn't sit under
            // Scripture in the back-stack — the tab bar remains
            // navigable but the back button won't leave a phantom stop.
            router.replace(route as never);
          }
        } catch (err) {
          // Non-fatal — cold-launch payload retrieval is a best-effort
          // read on iOS. Log for TestFlight triage but never throw into
          // the render tree.
          console.warn("[reminders] cold-launch response failed", err);
        }
      }

      // ---- Warm / foreground path -----------------------------------------
      try {
        sub = Notifications.addNotificationResponseReceivedListener(
          (response: any) => {
            const route = routeFromResponse(response);
            if (route) {
              router.replace(route as never);
            }
          },
        );
      } catch (err) {
        // Some Expo Go / SDK combinations expose the module but throw on
        // subscribe. Fail soft — the app still works, deep-linking is
        // simply disabled.
        console.warn(
          "[reminders] addNotificationResponseReceivedListener failed",
          err,
        );
      }
    })();

    return () => {
      cancelled = true;
      if (sub) {
        try {
          sub.remove();
        } catch {
          // ignore — teardown must never throw
        }
      }
    };
  }, [router]);
}
