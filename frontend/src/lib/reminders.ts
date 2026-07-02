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
// We request POST_NOTIFICATIONS the first time the user enables the toggle
// (never on cold launch — that would spook users). If they deny, we surface
// a toast pointing them to Settings and keep the app usable.
// -----------------------------------------------------------------------------
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// The single reminder we schedule. Naming this lets us cancel by identifier
// rather than nuking all scheduled notifications (leaves room for future
// non-reminder schedules — e.g. streak-at-risk nudges).
const DAILY_REMINDER_ID = "prayersloft-daily-reminder";

// Rotate the message body so the reminder doesn't feel scripted after a
// week of use. iOS schedules the body at CREATION time, so a single
// scheduled trigger will fire the same message every day until we
// reschedule. We reschedule on toggle-on and on time-change; the message
// is picked randomly from this list at each reschedule.
export const REMINDER_MESSAGES = [
  "Spend a few quiet moments with God today.",
  "Pause. Breathe. God is waiting to meet with you.",
  "Today's Scripture is ready.",
  "Continue your journey with God.",
  "Take a moment to pray and reflect.",
  "A few minutes with the Word can shape your whole day.",
  "God's Word is patient. Let it meet you where you are.",
  "Even a whispered prayer is heard.",
] as const;

function pickMessage(): string {
  return REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
}

// Parse a "HH:MM" 24h string into { hour, minute } — matches the format
// stored on Preferences.notificationsDailyTime. Falls back to 20:00 (8pm)
// on parse failure so a corrupted pref never blocks scheduling.
export function parseTime(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return { hour: 20, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}

// Format for the settings row subtitle + confirmation toast. Uses the
// device locale but forces 12-hour clock for the "8:00 PM" style copy
// the product spec asked for.
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
    // Fallback for very old runtimes where locale options aren't honored.
    const h12 = ((hour + 11) % 12) + 1;
    const ampm = hour >= 12 ? "PM" : "AM";
    return `${h12}:${minute.toString().padStart(2, "0")} ${ampm}`;
  }
}

/**
 * Ensure a foreground-friendly handler is registered.
 *
 * Without this, notifications that fire while the app is in the FOREGROUND
 * are silently swallowed on iOS. Called once from the app root.
 */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false, // calm nudge, not an alarm
      shouldSetBadge: false,
    }),
  });
}

/**
 * Prompt the user for notification permission if they haven't decided yet.
 * Returns true iff we can schedule after this call.
 *
 * We NEVER prompt on app launch — only at the moment the user flips the
 * daily-reminder toggle to ON. If they've already denied, we don't
 * re-prompt (iOS won't show the dialog anyway); the caller should surface
 * a toast pointing them to system Settings.
 */
export async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain === false) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: false,
    },
  });
  return asked.granted;
}

/**
 * Cancel any previously-scheduled daily reminder.
 * Safe to call unconditionally — no-ops if nothing was scheduled.
 */
export async function cancelDailyReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  } catch {
    // Missing identifier just means it wasn't scheduled; ignore.
  }
}

/**
 * Schedule (or reschedule) the repeating daily reminder at `hhmm` local time.
 *
 * Always cancels the previous one first so back-to-back time changes
 * don't leave orphaned schedules. Returns `{ ok: true }` on success or
 * `{ ok: false, reason }` with a machine-inspectable error the UI can
 * use to build a specific toast (permission vs generic schedule failure).
 *
 * TRIGGER CHOICE
 * --------------
 * We use the DAILY trigger (SchedulableTriggerInputTypes.DAILY) — it takes
 * { hour, minute } and repeats implicitly on both iOS and Android. Prior
 * versions of this module used CALENDAR with hour+minute+repeats, which
 * silently fails on SDK 53+/expo-notifications 0.32 because CalendarTriggerInput
 * no longer has hour/minute at the top level (those are individual calendar
 * components for one-shot dates). See:
 * https://docs.expo.dev/versions/latest/sdk/notifications/#dailytriggerinput
 */
export type ScheduleFailure =
  | { ok: false; reason: "permission" }
  | { ok: false; reason: "error"; error: unknown };
export type ScheduleResult = { ok: true } | ScheduleFailure;

export async function scheduleDailyReminder(hhmm: string): Promise<ScheduleResult> {
  const { hour, minute } = parseTime(hhmm);
  await cancelDailyReminder();

  // Defensive: iOS scheduleNotificationAsync silently refuses if permission
  // isn't granted, but we prefer to surface a specific error so the UI
  // can point the user at system Settings instead of a generic message.
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) {
    return { ok: false, reason: "permission" };
  }

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_REMINDER_ID,
      content: {
        title: "Prayers Loft",
        body: pickMessage(),
        // Bool | String — cannot be null. `false` means "silent notification"
        // on iOS. We deliberately don't play a sound because the reminder
        // is meant to be a calm nudge, not an alarm. See:
        // https://docs.expo.dev/versions/latest/sdk/notifications/#notificationcontentinput
        sound: false,
      },
      trigger: {
        // Repeats every day at { hour, minute } in the DEVICE's local time.
        // Cross-platform (iOS + Android). iOS re-anchors to the new local
        // time when the user travels, matching the Journal's local-tz streak.
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        ...(Platform.OS === "android" ? { channelId: "daily-reminder" } : {}),
      },
    });
    return { ok: true };
  } catch (error) {
    // Log the raw error for TestFlight/Xcode Console diagnostics so we can
    // triage any future platform-specific scheduling failure. Never re-throw
    // — the settings screen relies on the boolean to roll back its toggle.
    console.error("[reminders] scheduleNotificationAsync failed:", error);
    return { ok: false, reason: "error", error };
  }
}

/**
 * Android needs an explicit notification channel or notifications get
 * silently dropped on modern OS versions. Safe to call multiple times.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("daily-reminder", {
      name: "Daily reminder",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      vibrationPattern: [0, 0, 0, 0],
      lightColor: "#C8A96B",
    });
  } catch {
    // Non-fatal; iOS or old Android might reject the call.
  }
}
