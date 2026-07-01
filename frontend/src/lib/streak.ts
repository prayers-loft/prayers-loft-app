// -----------------------------------------------------------------------------
// Streak — pure client-side computation.
//
// SOURCE OF TRUTH (Build 14): the Journal's displayed streak is computed
// on-device from the timestamps of the current user's reflections + local
// saved prayers, keyed by the DEVICE'S LOCAL TIMEZONE (via new Date() /
// getFullYear/getMonth/getDate). This is intentional and gives us:
//
//   • Correct behavior when the user travels across timezones —
//     "today" is always the calendar day they see on their phone.
//   • Correct behavior during DST transitions — day boundaries follow
//     the local clock, not UTC.
//   • Instant post-save updates — no server round-trip to see the new streak.
//   • Per-user isolation — reflections come from api.listReflections() which
//     is owner-scoped (401s cross-user), and useFocusEffect reloads on nav.
//
// BACKEND divergence (documented for a future maintainer):
// backend/auth.py:911 currently computes StreakMeta.currentStreak using
// utcnow().date() as the anchor, i.e. UTC "today". This value is only
// materialized at guest→user migration time; the app never renders it,
// so the divergence is invisible today. If we ever move streaks fully
// server-side (e.g. for cross-device syncing, notifications, or leaderboards),
// the backend MUST accept a per-request tz / local_date parameter (mirroring
// /api/daily-verse) and rework the sorted_dates → current_run loop to use
// the user's LOCAL day. Tracked as follow-up ticket: JOURNAL-STREAK-TZ.
// See tests/tests/unit-streak.spec.ts for the timezone contract this module
// is expected to satisfy.
// -----------------------------------------------------------------------------

/**
 * Format a Date as a local-timezone YYYY-MM-DD key.
 * Uses the device's LOCAL calendar day (not UTC), so day boundaries
 * follow the phone's clock even during DST transitions and travel.
 */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build a set of local-day keys from a list of ISO timestamps. Any invalid
 * or missing timestamps are silently skipped — the streak is defined by
 * the days on which at least one activity was recorded.
 */
export function activeDaysFromISOs(isos: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const iso of isos) {
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    set.add(ymd(d));
  }
  return set;
}

/**
 * Compute the user's current daily streak from the set of active local-day
 * keys and an anchor "now" (defaults to real wall clock).
 *
 * Rules (matches pre-refactor product behavior verified by testing_agent
 * iter 13):
 *   1. If the anchor day is present in activeDays, the streak includes it.
 *   2. Otherwise we start counting from the day BEFORE the anchor —
 *      this lets a user who reflected daily for a week still see "7"
 *      before their entry for today lands.
 *   3. Walk backwards one calendar day at a time; the first missing day
 *      breaks the streak.
 *   4. Multiple entries on the same day count once (Set semantics).
 *
 * The `now` parameter exists specifically so unit tests can pin the
 * clock to a controlled local time; production callers should omit it.
 */
export function computeStreak(activeDays: Set<string>, now: Date = new Date()): number {
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!activeDays.has(ymd(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (activeDays.has(ymd(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Return the last N local calendar days (oldest first) starting from the
 * given anchor. Used to render the 14-day dot row on the streak card.
 */
export function lastNDays(n: number, now: Date = new Date()): Date[] {
  const out: Date[] = [];
  const anchor = new Date(now);
  anchor.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() - i);
    out.push(d);
  }
  return out;
}
