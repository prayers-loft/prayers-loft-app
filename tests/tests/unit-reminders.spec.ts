// -----------------------------------------------------------------------------
// unit-reminders — Build 16 notification polish regression tests.
//
// Covers the pure-function surface of src/lib/reminders.ts:
//   • Time parsing + formatting (round-trip stability)
//   • Message pool sanity (title length, no ALL CAPS, no guilt language)
//   • Deterministic weekly rotation
//   • Deep-link payload parsing (valid, wrong-kind, malformed, null)
//
// Storage-bound / native-module wrappers (installForegroundHandler,
// ensurePermission, scheduleDailyReminder, cancelAllDailyReminders) can't
// be exercised without a full Expo Notifications runtime, so this file
// deliberately sticks to the algorithmic surface. Manual verification
// checklist for the wrapper surface lives at the bottom of this file
// and in the PR description.
// -----------------------------------------------------------------------------
import { test, expect } from "@playwright/test";
import {
  REMINDER_MESSAGES,
  formatTime,
  isoWeekNumber,
  parseTime,
  pickMessagesForWeek,
  routeFromResponse,
} from "../../frontend/src/lib/reminders";

// ---------------------------------------------------------------------------
// Time parsing/formatting.
// ---------------------------------------------------------------------------

test.describe("reminders — parseTime + formatTime", () => {
  test("parseTime accepts HH:MM 24h and clamps out-of-range parts", () => {
    expect(parseTime("08:00")).toEqual({ hour: 8, minute: 0 });
    expect(parseTime("20:30")).toEqual({ hour: 20, minute: 30 });
    expect(parseTime("23:59")).toEqual({ hour: 23, minute: 59 });
    // Clamping
    expect(parseTime("25:70")).toEqual({ hour: 23, minute: 59 });
    expect(parseTime("-1:-1")).toEqual({ hour: 20, minute: 0 }); // regex miss → fallback
  });

  test("parseTime falls back to 20:00 on garbage input (never throws)", () => {
    expect(parseTime("")).toEqual({ hour: 20, minute: 0 });
    expect(parseTime("garbage")).toEqual({ hour: 20, minute: 0 });
    expect(parseTime("8")).toEqual({ hour: 20, minute: 0 });
    expect(parseTime(undefined as unknown as string)).toEqual({
      hour: 20,
      minute: 0,
    });
  });

  test("formatTime renders 12-hour clock with AM/PM", () => {
    // Locale-dependent formatting — assert the important tokens rather
    // than exact whitespace between them.
    const morning = formatTime("08:00");
    expect(morning).toMatch(/8:00\s?AM/i);
    const evening = formatTime("20:30");
    expect(evening).toMatch(/8:30\s?PM/i);
    const midnight = formatTime("00:15");
    expect(midnight).toMatch(/12:15\s?AM/i);
    const noon = formatTime("12:00");
    expect(noon).toMatch(/12:00\s?PM/i);
  });
});

// ---------------------------------------------------------------------------
// Copy audit — enforces the Build 16 spec's tone requirements at build time.
// ---------------------------------------------------------------------------

test.describe("reminders — REMINDER_MESSAGES copy audit", () => {
  test("pool has at least 7 entries — one full week of unique content", () => {
    expect(REMINDER_MESSAGES.length).toBeGreaterThanOrEqual(7);
  });

  test("every title is <= 45 characters (iOS truncation guard)", () => {
    for (const m of REMINDER_MESSAGES) {
      expect(m.title.length, `title too long: "${m.title}"`).toBeLessThanOrEqual(45);
    }
  });

  test("no ALL-CAPS-shouting titles or bodies", () => {
    const allCapsWord = /\b[A-Z]{4,}\b/;
    for (const m of REMINDER_MESSAGES) {
      expect(allCapsWord.test(m.title), `ALL CAPS in title: "${m.title}"`).toBe(false);
      expect(allCapsWord.test(m.body), `ALL CAPS in body: "${m.body}"`).toBe(false);
    }
  });

  test("no guilt-based language (must never scold the user)", () => {
    const guilt = /\b(you missed|don't forget|why haven'?t|slacking|failing|missed again)\b/i;
    for (const m of REMINDER_MESSAGES) {
      expect(guilt.test(m.title), `guilt in title: "${m.title}"`).toBe(false);
      expect(guilt.test(m.body), `guilt in body: "${m.body}"`).toBe(false);
    }
  });

  test("no spammy marketing language", () => {
    const spam = /\b(limited time|act now|last chance|hurry|only today|click here|free!!!)\b/i;
    for (const m of REMINDER_MESSAGES) {
      expect(spam.test(m.title), `spam in title: "${m.title}"`).toBe(false);
      expect(spam.test(m.body), `spam in body: "${m.body}"`).toBe(false);
    }
  });

  test("no exclamation-mark spam (allow at most one per body, none in title)", () => {
    for (const m of REMINDER_MESSAGES) {
      expect((m.title.match(/!/g) || []).length, `bang in title: "${m.title}"`).toBe(0);
      expect((m.body.match(/!/g) || []).length, `bangs in body: "${m.body}"`).toBeLessThanOrEqual(1);
    }
  });

  test("no duplicate title+body pairs", () => {
    const seen = new Set<string>();
    for (const m of REMINDER_MESSAGES) {
      const key = `${m.title}||${m.body}`;
      expect(seen.has(key), `duplicate message: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic weekly rotation.
// ---------------------------------------------------------------------------

test.describe("reminders — pickMessagesForWeek rotation", () => {
  test("returns exactly 7 entries", () => {
    expect(pickMessagesForWeek(1)).toHaveLength(7);
    expect(pickMessagesForWeek(42)).toHaveLength(7);
  });

  test("all 7 entries within a single week are unique when pool >= 7", () => {
    // With pool size 14 and step 3, gcd(14, 3) = 1, so 7 consecutive
    // offsets are all different regardless of seed.
    const seeds = [1, 5, 12, 27, 53];
    for (const s of seeds) {
      const week = pickMessagesForWeek(s);
      const titles = week.map((m) => m.title);
      expect(new Set(titles).size, `dupes at seed ${s}`).toBe(7);
    }
  });

  test("deterministic — same seed yields same week", () => {
    const a = pickMessagesForWeek(10);
    const b = pickMessagesForWeek(10);
    expect(a.map((m) => m.title)).toEqual(b.map((m) => m.title));
  });

  test("different seeds produce different weeks (rotation)", () => {
    const a = pickMessagesForWeek(0).map((m) => m.title);
    const b = pickMessagesForWeek(1).map((m) => m.title);
    // The step is 3, so the second week's first message is 3 positions
    // into the pool — different by construction.
    expect(a).not.toEqual(b);
  });

  test("isoWeekNumber returns 1..53 across a full year", () => {
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2026, m, 15));
      const w = isoWeekNumber(d);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(53);
    }
  });
});

// ---------------------------------------------------------------------------
// Deep-link payload parsing.
// ---------------------------------------------------------------------------

// The NotificationResponse type is expo-notifications-specific, so we
// construct plain objects that share the shape our parser reads.
function makeResponse(data: unknown) {
  return {
    notification: { request: { content: { data } } },
  } as unknown as Parameters<typeof routeFromResponse>[0];
}

test.describe("reminders — routeFromResponse payload parsing", () => {
  test("valid daily-verse payload returns the route", () => {
    const r = makeResponse({ kind: "daily-verse", route: "/(tabs)/scripture" });
    expect(routeFromResponse(r)).toBe("/(tabs)/scripture");
  });

  test("legacy 'daily-reminder' kind (Build 15) still routes — backward compat", () => {
    const r = makeResponse({ kind: "daily-reminder", route: "/(tabs)/scripture" });
    expect(routeFromResponse(r)).toBe("/(tabs)/scripture");
  });

  test("unknown kind is ignored (future notification types don't hijack)", () => {
    const r = makeResponse({ kind: "some-future-kind", route: "/danger" });
    expect(routeFromResponse(r)).toBeNull();
  });

  test("missing kind is ignored — safety net against unpayloaded notifs", () => {
    const r = makeResponse({ route: "/(tabs)/scripture" });
    expect(routeFromResponse(r)).toBeNull();
  });

  test("missing route returns null even with valid kind", () => {
    const r = makeResponse({ kind: "daily-verse" });
    expect(routeFromResponse(r)).toBeNull();
  });

  test("non-string route is rejected — malformed payload safety", () => {
    const r = makeResponse({ kind: "daily-verse", route: 42 });
    expect(routeFromResponse(r)).toBeNull();
  });

  test("null response returns null (cold-launch: no response available)", () => {
    expect(routeFromResponse(null)).toBeNull();
    expect(routeFromResponse(undefined)).toBeNull();
  });

  test("empty-object response returns null (malformed OS payload)", () => {
    expect(
      routeFromResponse({} as unknown as Parameters<typeof routeFromResponse>[0]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Manual verification checklist — items that can only be validated on
// physical devices via TestFlight. This block does not execute tests; it
// documents what a reviewer should confirm before shipping Build 16.
// ---------------------------------------------------------------------------
//
// [ ] Fresh install: cold launch does NOT show the OS notification prompt.
// [ ] Settings → toggle Daily Reminder ON: primer sheet appears; only
//     after tapping "Continue" does the iOS prompt appear.
// [ ] Primer "Not now": sheet dismisses, toggle stays OFF, no OS prompt.
// [ ] Permission denied at OS prompt: friendly toast, toggle stays OFF,
//     app remains fully usable.
// [ ] Existing user upgrade from Build 15: enabling reminders cancels the
//     old single-schedule (id "prayersloft-daily-reminder") — verified
//     via cancelAllDailyReminders() which matches both legacy id and
//     new kind.
// [ ] Repeated toggle-off/on does not stack notifications (verified via
//     Notifications.getAllScheduledNotificationsAsync() showing exactly
//     7 items).
// [ ] Change reminder time twice quickly: old schedule fully replaced.
// [ ] App terminated + tap notification: launches app AND routes to
//     Scripture tab (cold-launch deep link).
// [ ] App backgrounded + tap notification: brings forward AND routes.
// [ ] App foregrounded when reminder fires: banner drops, tap routes.
// [ ] Different message body visible each day of the week (rotation).
// [ ] Toggle OFF cancels all 7 scheduled items.
