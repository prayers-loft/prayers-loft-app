// -----------------------------------------------------------------------------
// useNotificationDeepLink — routes daily-reminder taps to Scripture.
//
// Wire it once at the app root (below expo-router's Stack so the router is
// available). The hook handles three launch paths:
//
//   1. Cold launch — app was killed and the user tapped the reminder to
//      start it.
//   2. Warm background — app suspended and reminder tapped.
//   3. Foreground — banner drops while the app is open.
//
// EXPO-GO COMPATIBILITY
// ---------------------
// All expo-notifications access goes through src/lib/notification-module.ts's
// `getNotificationModule()`, which returns `null` when running in Expo Go.
// In that case this hook silently no-ops and the app continues to work with
// deep-linking simply disabled. See notification-module.ts for the full
// story on why lazy `import()` alone was NOT enough to prevent the
// PushNotificationIOS crash on cold start.
// -----------------------------------------------------------------------------
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { routeFromResponse } from "@/src/lib/reminders";
import {
  getNotificationModule,
  isNotificationRuntimeUnavailable,
} from "@/src/lib/notification-module";

let coldLaunchHandled = false;

export function useNotificationDeepLink(): void {
  const router = useRouter();

  useEffect(() => {
    // Early exit: if we're on a runtime that can't load expo-notifications
    // (Expo Go on SDK 53+), never even attempt the dynamic import.
    // Metro's `importAll` on `expo-notifications` transitively touches
    // RN's lazy `PushNotificationIOS` getter and crashes with an
    // invariant. See notification-module.ts.
    if (isNotificationRuntimeUnavailable()) return;

    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    (async () => {
      const Notifications = await getNotificationModule();
      if (!Notifications || cancelled) return;

      // Cold-launch path — read the response that launched the app.
      if (!coldLaunchHandled) {
        coldLaunchHandled = true;
        try {
          const response =
            await Notifications.getLastNotificationResponseAsync();
          if (cancelled) return;
          const route = routeFromResponse(response);
          if (route) {
            router.replace(route as never);
          }
        } catch (err) {
          console.warn("[reminders] cold-launch response failed", err);
        }
      }

      // Warm / foreground path — subscribe to future taps.
      try {
        sub = Notifications.addNotificationResponseReceivedListener(
          (response) => {
            const route = routeFromResponse(response);
            if (route) {
              router.replace(route as never);
            }
          },
        );
      } catch (err) {
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
