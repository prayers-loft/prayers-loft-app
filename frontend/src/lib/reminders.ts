// -----------------------------------------------------------------------------
// Daily reminder — local (device-scheduled) notifications.
//
// This module owns everything about the daily-reminder feature except the UI.
// It uses expo-notifications' LOCAL scheduling API (no server, no push token),
// so a reminder fires from the device itself at the user's chosen time even
// when the phone is offline.
//
// PLATFORM NOTE
// -------------
// expo-notifications LOCAL scheduling works on iOS/Android real builds.
// It does NOT fire inside the Expo Go sandbox on SDK 53+; the schedule call
// still succeeds but no notification is delivered. Users must run this on
// a development/production build (e.g. TestFlight) to actually validate.
//
// PERMISSIONS
// -----------
// We NEVER prompt on cold launch — that spooks users. The Settings screen
// shows a NotificationPrimerSheet that explains the benefit first, and only
// then calls ensurePermission(). If the user denies, we surface a toast
// pointing them to system Settings and keep the app fully usable.
//
// SCHEDULING MODEL
// ----------------
// iOS's DAILY trigger fires the same static body every day until you
// reschedule — which produced the "same nudge forever" bug in Build 15.
// We now schedule SEVEN weekday triggers, one per day of the week, each
// carrying a *different* curated title+body. iOS/Android handle the
// recurring firing natively. The user sees a rotating message every day
// with zero repetition inside a 7-day window.
//
// A single identifier prefix (`prayersloft-daily-reminder-w{1-7}`) lets us
// enumerate + cancel all seven with cancelAllDailyReminders(), so switching
// times or types never leaves orphaned schedules stacked in iOS's queue.
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Daily reminder — local (device-scheduled) notifications.
// (Header omitted for brevity — see history.)
// -----------------------------------------------------------------------------

// expo-notifications and react-native both drag in native modules that
// can't be loaded by Node during pure unit tests. We reach for them via
// lazy dynamic imports inside each function that actually needs them, so
// the pure helpers below (parseTime, formatTime, pickMessagesForWeek,
// isoWeekNumber, routeFromResponse) remain importable from Node-only
// test environments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _notif(): Promise<any> {
  return await import("expo-notifications");
}
async function _platformOS(): Promise<string> {
  try {
    const RN = await import("react-native");
    return RN.Platform.OS;
  } catch {
    return "web";
  }
}
// Types-only import — `import type` is erased at runtime, so no native
// module is loaded when this file is imported by Node tests.
import type * as NotificationsType from "expo-notifications";

// ---------------------------------------------------------------------------
// Reminder kinds. Only "daily-verse" is implemented in Build 16. The union
// exists so future kinds (prayer, streak-at-risk) plug in without a
// refactor — each carries its own route in the notification payload, and
// routeFromResponse() dispatches on `kind`.
// ---------------------------------------------------------------------------
export type ReminderKind = "daily-verse";

const DAILY_VERSE_ID_PREFIX = "prayersloft-daily-reminder-w";

/** Curated pool of (title, body) pairs used for the daily reminder.
 *
 * Rules from the Build 16 spec:
 *   • Title ≤ 45 chars, no ALL CAPS, no exclamation-heavy pressure.
 *   • Body encouraging, never guilt-based ("you missed…"), never spammy.
 *   • Themes span: pray, Scripture, quiet time, presence, gratitude,
 *     hope, peace, strength — no single tone dominates.
 *
 * At least 14 messages so that a single 7-day rotation still leaves
 * variety across weeks (see pickMessagesForWeek()).
 */
export const REMINDER_MESSAGES: ReadonlyArray<{ title: string; body: string }> =
  [
    {
      title: "Today's Scripture is ready",
      body: "Open the Word for a few quiet minutes.",
    },
    {
      title: "A moment with God",
      body: "Pause. Breathe. Let this verse meet you where you are.",
    },
    {
      title: "Continue your journey",
      body: "Your daily verse and reflection are waiting.",
    },
    {
      title: "Time to pray",
      body: "Even a whispered prayer is heard.",
    },
    {
      title: "Rest in the Word",
      body: "A few minutes of Scripture can shape your whole day.",
    },
    {
      title: "Gentle nudge from Prayers Loft",
      body: "Your quiet moment with God is ready.",
    },
    {
      title: "Reflect on today's verse",
      body: "Sit with it. Let it settle. Then move on with peace.",
    },
    {
      title: "Come as you are",
      body: "God isn't waiting for the perfect moment. Just this one.",
    },
    {
      title: "A quiet invitation",
      body: "Scripture, prayer, reflection — a little practice, a lot of peace.",
    },
    {
      title: "Meet with God",
      body: "Today's verse is waiting to speak to you.",
    },
    {
      title: "Take a breath",
      body: "Then take a moment for the Word.",
    },
    {
      title: "Your daily verse",
      body: "Read, reflect, and carry it with you today.",
    },
    {
      title: "Time in the Word",
      body: "A short pause. A steady heart. He is near.",
    },
    {
      title: "Grace for today",
      body: "Open Scripture and receive what you need.",
    },
  ] as const;

// Sanity check at module load — cheap and catches copy regressions.
// Titles > 45 chars get truncated in iOS notification banners. Guarded
// with `typeof __DEV__` so this file remains importable from Node
// (Playwright unit tests) where the RN dev global isn't injected.
if (typeof __DEV__ !== "undefined" && __DEV__) {
  for (const m of REMINDER_MESSAGES) {
    if (m.title.length > 45) {
      console.warn(
        `[reminders] title over 45 chars will truncate: "${m.title}"`,
      );
    }
  }
}

/** Return 7 message picks (one per weekday), rotated deterministically by
 *  the ISO week number so users don't see the same Monday message forever.
 *
 *  Deterministic (not random) so that after a reschedule, the messages
 *  for the current week are stable even if the app is reopened multiple
 *  times before the OS actually enqueues them.
 */
export function pickMessagesForWeek(
  seed: number = isoWeekNumber(new Date()),
): Array<{ title: string; body: string }> {
  const pool = REMINDER_MESSAGES;
  // Offset walks the pool by the ISO-week seed so each week rotates.
  // The step of 3 is coprime with common pool sizes (14, 21) so we hit
  // every message before repeating within a small number of weeks.
  const step = 3;
  const out: Array<{ title: string; body: string }> = [];
  for (let i = 0; i < 7; i++) {
    const idx = (seed * step + i) % pool.length;
    out.push(pool[idx]);
  }
  return out;
}

/** ISO 8601 week number (1-53) — used purely as a rotation seed. */
export function isoWeekNumber(d: Date): number {
  // Copy so we don't mutate caller's Date.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Thursday in current week decides the year.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
}

// ---------------------------------------------------------------------------
// Time helpers (HH:MM 24h ↔ display).
// ---------------------------------------------------------------------------

/** Parse a "HH:MM" 24h string into { hour, minute }. Falls back to 20:00
 *  (8pm) on parse failure so a corrupted pref never blocks scheduling. */
export function parseTime(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return { hour: 20, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}

/** Format for the settings row + confirmation toast, e.g. "8:00 PM". */
export function formatTime(hhmm: string): string {
  const { hour, minute } = parseTime(hhmm);
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  try {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    const h12 = ((hour + 11) % 12) + 1;
    const ampm = hour >= 12 ? "PM" : "AM";
    return `${h12}:${minute.toString().padStart(2, "0")} ${ampm}`;
  }
}

// ---------------------------------------------------------------------------
// Foreground handler + Android channel — both wrapped in try/catch at the
// module level so a native-module failure never bubbles to the render tree.
// ---------------------------------------------------------------------------

/** Register a foreground-friendly handler. Without this, notifications that
 *  fire while the app is in the FOREGROUND are silently swallowed on iOS. */
export function installForegroundHandler(): void {
  // Fire-and-forget: the handler is a fire-once side-effect that must not
  // block synchronous callers. Errors are swallowed so a missing native
  // module (Expo Go on an unsupported channel, etc.) can never crash the
  // app root.
  _notif()
    .then((N) => {
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false, // calm nudge, not an alarm
          shouldSetBadge: false,
        }),
      });
    })
    .catch((e) => {
      console.warn("[reminders] installForegroundHandler failed", e);
    });
}

export async function ensureAndroidChannel(): Promise<void> {
  if ((await _platformOS()) !== "android") return;
  try {
    const N = await _notif();
    await N.setNotificationChannelAsync("daily-reminder", {
      name: "Daily reminder",
      importance: N.AndroidImportance.DEFAULT,
      sound: null,
      vibrationPattern: [0, 0, 0, 0],
      lightColor: "#C8A96B",
    });
  } catch (e) {
    console.warn("[reminders] ensureAndroidChannel failed", e);
  }
}

// ---------------------------------------------------------------------------
// Permissions.
// ---------------------------------------------------------------------------

/** Return the current OS notification permission status without prompting. */
export async function getPermissionStatus(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  try {
    const N = await _notif();
    const p = await N.getPermissionsAsync();
    return { granted: !!p.granted, canAskAgain: p.canAskAgain !== false };
  } catch (e) {
    console.warn("[reminders] getPermissionStatus failed", e);
    return { granted: false, canAskAgain: false };
  }
}

/** Prompt the user for notification permission if they haven't decided yet.
 *
 *  We NEVER prompt on cold launch — the caller (settings screen or primer
 *  sheet) is responsible for showing a benefit-first explanation before
 *  invoking this. If the user already denied, we don't re-prompt
 *  (iOS wouldn't show the dialog anyway); the caller must surface a
 *  "open Settings" toast.
 */
export async function ensurePermission(): Promise<boolean> {
  try {
    const N = await _notif();
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain === false) return false;
    const asked = await N.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    });
    return asked.granted;
  } catch (e) {
    console.warn("[reminders] ensurePermission failed", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scheduling.
// ---------------------------------------------------------------------------

export type ScheduleFailure =
  | { ok: false; reason: "permission" }
  | { ok: false; reason: "error"; error: unknown };
export type ScheduleResult = { ok: true; count: number } | ScheduleFailure;

/** Cancel every daily-reminder we've scheduled — enumerates the notification
 *  queue and matches on kind so orphaned IDs from previous app versions are
 *  also cleaned up. Safe to call unconditionally. */
export async function cancelAllDailyReminders(): Promise<void> {
  try {
    const N = await _notif();
    const scheduled = await N.getAllScheduledNotificationsAsync();
    const ids = scheduled
      .filter((n) => {
        const data = n?.content?.data as
          | { kind?: unknown }
          | undefined;
        const id = n?.identifier ?? "";
        // Match by kind (preferred) OR by legacy id prefix so Build 15
        // schedules get cleaned up on upgrade.
        return (
          data?.kind === "daily-verse" ||
          id.startsWith(DAILY_VERSE_ID_PREFIX) ||
          id === "prayersloft-daily-reminder" // Build 15 single-id
        );
      })
      .map((n) => n.identifier)
      .filter(Boolean);
    for (const id of ids) {
      try {
        await N.cancelScheduledNotificationAsync(id);
      } catch {
        // Missing identifier just means it was already gone; ignore.
      }
    }
  } catch (e) {
    // If we can't read the queue, fall back to explicit cancel by our
    // known IDs. Never throw — cancellation errors must not block the UI.
    console.warn("[reminders] cancelAll: queue read failed, trying by id", e);
    try {
      const N = await _notif();
      for (let w = 1; w <= 7; w++) {
        try {
          await N.cancelScheduledNotificationAsync(
            `${DAILY_VERSE_ID_PREFIX}${w}`,
          );
        } catch {
          // ignore
        }
      }
      try {
        await N.cancelScheduledNotificationAsync("prayersloft-daily-reminder");
      } catch {
        // ignore
      }
    } catch {
      // ignore — cancellation errors must never block the UI
    }
  }
}

/** Schedule (or reschedule) the daily verse reminder at `hhmm` local time.
 *
 *  Under the hood this creates SEVEN weekly triggers — one per weekday —
 *  each with a distinct curated title+body. iOS/Android fire the correct
 *  one on the correct day and repeat forever, so the user sees rotating
 *  content with no server round-trip.
 *
 *  Always cancels prior daily reminders first (by kind), so back-to-back
 *  time changes never leave orphaned schedules. Returns { ok: true,
 *  count } on success or { ok: false, reason } with a machine-inspectable
 *  error the UI can use to build a specific toast.
 */
export async function scheduleDailyReminder(
  hhmm: string,
): Promise<ScheduleResult> {
  const { hour, minute } = parseTime(hhmm);
  await cancelAllDailyReminders();

  // Defensive: iOS scheduleNotificationAsync silently refuses if permission
  // isn't granted. We prefer to surface a specific error so the UI can
  // route the user to system Settings instead of a generic message.
  const perm = await getPermissionStatus();
  if (!perm.granted) return { ok: false, reason: "permission" };

  const week = pickMessagesForWeek();
  let scheduled = 0;
  try {
    const N = await _notif();
    const isAndroid = (await _platformOS()) === "android";
    for (let weekday = 1; weekday <= 7; weekday++) {
      const msg = week[weekday - 1];
      await N.scheduleNotificationAsync({
        identifier: `${DAILY_VERSE_ID_PREFIX}${weekday}`,
        content: {
          title: msg.title,
          body: msg.body,
          // Bool | String — cannot be null. `false` = silent notification
          // on iOS. The reminder is a calm nudge, not an alarm.
          sound: false,
          // Deep-link payload. useNotificationDeepLink() dispatches on
          // `kind` and routes to `route`. Keep both — future kinds
          // (prayer, streak) will use their own routes.
          data: {
            kind: "daily-verse" as ReminderKind,
            route: "/(tabs)/scripture",
          },
        },
        trigger: {
          // Weekly, on this specific weekday, at { hour, minute } local.
          // iOS re-anchors to local time when the user travels — matches
          // the Journal's local-tz streak semantics.
          type: N.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour,
          minute,
          ...(isAndroid ? { channelId: "daily-reminder" } : {}),
        },
      });
      scheduled++;
    }
    return { ok: true, count: scheduled };
  } catch (error) {
    // Roll back partial state so we don't leave a half-scheduled week.
    await cancelAllDailyReminders();
    console.error("[reminders] scheduleNotificationAsync failed:", error);
    return { ok: false, reason: "error", error };
  }
}

/** Back-compat alias for a future caller that expects the old single-schedule
 *  entrypoint. New code should use cancelAllDailyReminders(). */
export const cancelDailyReminder = cancelAllDailyReminders;

// ---------------------------------------------------------------------------
// Tap-response deep linking.
// ---------------------------------------------------------------------------

/** Read the tap-response's target route, defensively normalizing shapes.
 *  Returns null when the tap didn't carry a routable payload — anything
 *  from a future non-reminder notification is left alone. */
export function routeFromResponse(
  response: NotificationsType.NotificationResponse | null | undefined,
): string | null {
  if (!response) return null;
  const data = response.notification?.request?.content?.data as
    | { route?: unknown; kind?: unknown }
    | undefined;
  if (!data || typeof data.route !== "string") return null;
  // Only handle notifications we ourselves scheduled. New kinds can add
  // themselves here without hijacking existing routing.
  if (data.kind !== "daily-verse" && data.kind !== "daily-reminder") {
    return null;
  }
  return data.route;
}
