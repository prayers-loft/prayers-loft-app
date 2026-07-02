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
// -----------------------------------------------------------------------------
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { routeFromResponse } from "@/src/lib/reminders";

let coldLaunchHandled = false;

export function useNotificationDeepLink(): void {
  const router = useRouter();

  useEffect(() => {
    // ---- Cold-launch path -------------------------------------------------
    // getLastNotificationResponseAsync() returns the response that launched
    // the app, or null if the app was launched normally. We resolve it once
    // per session; the module-level guard prevents re-triggering across
    // hot reloads (which would re-route the user mid-session).
    if (!coldLaunchHandled) {
      coldLaunchHandled = true;
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          const route = routeFromResponse(response);
          if (route) {
            // Use replace() so the initial "/" screen doesn't sit under
            // Scripture in the back-stack — the tab bar remains
            // navigable but the back button won't leave a phantom stop.
            router.replace(route as never);
          }
        })
        .catch((err) => {
          // Non-fatal — cold-launch payload retrieval is a best-effort
          // read on iOS. Log for TestFlight triage but never throw into
          // the render tree.
          console.warn("[reminders] cold-launch response failed", err);
        });
    }

    // ---- Warm / foreground path ------------------------------------------
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeFromResponse(response);
      if (route) {
        router.replace(route as never);
      }
    });
    return () => {
      sub.remove();
    };
  }, [router]);
}
