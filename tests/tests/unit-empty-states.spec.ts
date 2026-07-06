// -----------------------------------------------------------------------------
// unit-empty-states — content + routing contract for every empty-state
// copy block in the app.
//
// WHY THIS FILE EXISTS
// --------------------
// Empty-state copy is easy to regress on:
//   • an over-eager copy tweak slips a "!" or a scolding "should" past
//     PR review
//   • the CTA route quietly drifts from /(tabs)/scripture to /(tabs)/prayer
//     and the "first meaningful action" contract fragments
//   • a body string balloons past three lines on a narrow phone
//
// These tests import the copy module directly (pure TS, no RN runtime
// needed) and pin the invariants that keep every empty state feeling
// coherent, invitational, and consistent across surfaces.
// -----------------------------------------------------------------------------
import { test, expect } from "@playwright/test";
import {
  EMPTY_CTA_ROUTE,
  JOURNAL_EMPTY,
  JOURNAL_LOAD_ERROR,
  JOURNAL_AUTH_EXPIRED,
  BIBLE_ASSISTANT_EMPTY,
  BIBLE_ASSISTANT_ERROR,
  DAILY_VERSE_ERROR,
} from "../../frontend/src/lib/empty-state-copy";

// All the copy blocks share a common shape (title + body). We audit them
// together so future additions get the same content contract for free.
const ALL_BLOCKS = [
  { name: "JOURNAL_EMPTY", copy: JOURNAL_EMPTY },
  { name: "JOURNAL_LOAD_ERROR", copy: JOURNAL_LOAD_ERROR },
  { name: "JOURNAL_AUTH_EXPIRED", copy: JOURNAL_AUTH_EXPIRED },
  { name: "BIBLE_ASSISTANT_EMPTY", copy: BIBLE_ASSISTANT_EMPTY },
  { name: "BIBLE_ASSISTANT_ERROR", copy: BIBLE_ASSISTANT_ERROR },
  { name: "DAILY_VERSE_ERROR", copy: DAILY_VERSE_ERROR },
] as const;

// Words that push the copy toward guilt / scolding / religious pressure.
// The list is intentionally short — we're not trying to sanitize the
// Bible, we're catching cases where the *app* nudges the user with
// language that doesn't belong in an empty state.
const GUILT_WORDS = [
  "should", // "you should try again" — nope
  "must", // "you must sign in" — replace with "sign in to…"
  "failed", // "reflection failed" — say what actually happened
  "error", // "an error occurred" — describe the state
  "oops",
  "sorry, ",
];

test.describe("empty-state-copy — content audit", () => {
  test("CTA route is the canonical Scripture tab", () => {
    // If this ever drifts, the "start here" contract fragments — some
    // screens send users to Prayer, others to Journal, etc. Kept in
    // lock-step with onboarding's FIRST_ACTION_ROUTE (which points to
    // the same place).
    expect(EMPTY_CTA_ROUTE).toBe("/(tabs)/scripture");
  });

  for (const { name, copy } of ALL_BLOCKS) {
    test(`${name} has a non-empty title + body`, () => {
      expect(copy.title.trim().length).toBeGreaterThan(0);
      expect(copy.body.trim().length).toBeGreaterThan(0);
    });

    test(`${name} title is short enough for a single line on a narrow phone`, () => {
      // 40 chars is roughly the wrap point for a semibold 15pt title on
      // the tightest supported width (SE-class devices at ~320pt).
      expect(copy.title.length).toBeLessThanOrEqual(40);
    });

    test(`${name} body stays under 200 chars (≈ 3 comfortable lines)`, () => {
      expect(copy.body.length).toBeLessThanOrEqual(200);
    });

    test(`${name} avoids guilt / scolding language`, () => {
      const lower = `${copy.title} ${copy.body} ${
        "hint" in copy ? (copy as { hint?: string }).hint ?? "" : ""
      }`.toLowerCase();
      for (const bad of GUILT_WORDS) {
        expect(lower).not.toContain(bad);
      }
    });

    test(`${name} avoids exclamation-mark spam`, () => {
      // We allow zero — a spiritual/wellness app that yells at empty
      // states reads as amateur. Titles and bodies both.
      expect(copy.title).not.toContain("!");
      expect(copy.body).not.toContain("!");
    });

    test(`${name} title does not end with a period (title case, not sentence)`, () => {
      // Design contract: titles are label-style, not sentences. Prevents
      // "My Journal." vs "My Journal" drift.
      expect(copy.title.trim()).not.toMatch(/\.$/);
    });
  }
});

test.describe("empty-state-copy — CTA labels", () => {
  test("JOURNAL_EMPTY CTA nudges toward opening Scripture", () => {
    // The user must be able to guess what tapping does from the label
    // alone — no "Continue" / "Next" mystery buttons.
    expect(JOURNAL_EMPTY.cta.toLowerCase()).toContain("scripture");
  });

  test("Recoverable-error blocks all offer a retry-shaped CTA", () => {
    // Any error state with a CTA must speak the language of retry so
    // the user knows the recovery path without reading the body.
    expect(JOURNAL_LOAD_ERROR.cta.toLowerCase()).toMatch(/try|retry|again/);
    expect(DAILY_VERSE_ERROR.cta.toLowerCase()).toMatch(/try|retry|again/);
  });

  test("JOURNAL_AUTH_EXPIRED sends the user somewhere actionable", () => {
    // Auth-expired is NOT a network hiccup — the retry frame is wrong
    // here. The CTA must route to a place where sign-in actually lives.
    expect(JOURNAL_AUTH_EXPIRED.cta.toLowerCase()).toContain("settings");
  });
});
