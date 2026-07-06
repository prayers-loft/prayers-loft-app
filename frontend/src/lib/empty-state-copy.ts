// -----------------------------------------------------------------------------
// empty-state-copy — single source of truth for every empty-state string
// and CTA route across the app.
//
// WHY THIS FILE EXISTS
// --------------------
// Empty-state copy is a tiny but high-leverage surface. It's what users
// see when they open the app for the first time, when the network dies,
// when a request fails, when they haven't saved anything yet. If the
// wording is inconsistent (or worse — guilt-y, alarmist, or blame-y), the
// app feels amateurish; if the CTAs point to different routes across
// screens, the user's mental model of "where to start" fragments.
//
// This module pins:
//   • the text strings (title / body / hint / cta) for every surface
//   • the single canonical CTA route (Today's Verse) that all "get
//     started" nudges point at — same contract onboarding uses
//
// Screen files import these constants. Unit tests import them too and
// audit them for:
//   • no guilt language (no "should", no "must", no scolding)
//   • no exclamation-mark spam (at most 0 per body)
//   • reasonable length (titles ≤ 40, bodies ≤ 200)
//   • non-empty title + body
//   • CTA route stays consistent
// -----------------------------------------------------------------------------

/** Every screen with an empty state routes to today's verse as the first
 *  meaningful action — same contract as onboarding.
 *  See lib/onboarding.ts FIRST_ACTION_ROUTE. */
export const EMPTY_CTA_ROUTE = "/(tabs)/scripture" as const;

// ---------------------------------------------------------------------------
// Journal — reflections-history screen.
// ---------------------------------------------------------------------------

/** Shown when the user has no reflections AND no saved prayers on
 *  device. Positive, invitational — never guilty. */
export const JOURNAL_EMPTY = {
  title: "Your journal starts here",
  body:
    "Reflections and saved prayers will appear here as you spend time in God's Word.",
  hint:
    "Write your first reflection from today's Scripture, or save a prayer from the Prayer tab.",
  cta: "Open today's Scripture",
} as const;

/** Distinct from JOURNAL_EMPTY: shown when the initial reflections fetch
 *  fails AND no local data is available. Explicitly non-alarming — this
 *  is a soft "try again" UX, not a red error banner. */
export const JOURNAL_LOAD_ERROR = {
  title: "We couldn't reach your journal",
  body: "Your entries are safe — this looks like a network hiccup.",
  cta: "Try again",
} as const;

/** Session expired but the user still has an account. Routes to Settings
 *  where the sign-in flow lives. */
export const JOURNAL_AUTH_EXPIRED = {
  title: "Sign in to see your journal",
  body:
    "Your session has expired. Sign in again from Settings to access My Journal.",
  cta: "Open Settings",
} as const;

// ---------------------------------------------------------------------------
// Bible Assistant tab.
// ---------------------------------------------------------------------------

/** No question asked yet — the input above is empty. */
export const BIBLE_ASSISTANT_EMPTY = {
  title: "Ask anything",
  body:
    "Pose a question or enter a topic above — your study companion will meet you where you are.",
} as const;

/** The last question failed (network / server). Same input still holds
 *  the question, so the CTA is a retry hint rather than a route. */
export const BIBLE_ASSISTANT_ERROR = {
  title: "That didn't reach the server",
  body:
    "Check your connection and try asking again — your question is still in the box above.",
} as const;

// ---------------------------------------------------------------------------
// Scripture / Daily Verse.
// ---------------------------------------------------------------------------

/** Phase-1 verse fetch failed. Skeletons don't cover this case — showing
 *  a blank card leaves the user confused about whether they should wait
 *  or reload. */
export const DAILY_VERSE_ERROR = {
  title: "Today's verse didn't load",
  body:
    "This is usually a network hiccup. Pull down to refresh, or try again in a moment.",
  cta: "Try again",
} as const;

// All copy strings audited at test time. See
// tests/tests/unit-empty-states.spec.ts.
