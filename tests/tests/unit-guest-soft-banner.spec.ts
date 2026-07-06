// -----------------------------------------------------------------------------
// unit-guest-soft-banner — visibility contract for the "Save your spiritual
// journey" nudge.
//
// WHY THIS FILE EXISTS
// --------------------
// The banner had a Build 16 bug: it rendered for signed-in Google users
// (because it was storage-driven only). The regression pinned here is
// the auth-aware render gate that fixes that bug — three invariants:
//   1. NEVER render while auth is loading (state.ready === false).
//      Prevents a flash for signed-in users on cold start.
//   2. NEVER render when signed in (state.user != null).
//   3. ONLY render for confirmed anonymous users, and even then only
//      when the 14-day dismiss window is either untouched or expired.
//
// These are exactly the invariants the user asked for. The predicate
// is pure — no React, no storage — so we can hammer it with edge cases
// (corrupt dismiss timestamps, boundary at exactly 14d, etc.) without
// mounting the component.
// -----------------------------------------------------------------------------
import { test, expect } from "@playwright/test";
import { shouldRenderGuestSoftBanner } from "../../frontend/src/lib/guest-soft-banner-visibility";

const DAY_MS = 24 * 60 * 60 * 1000;
// Fixed "now" reference for deterministic dismiss-window arithmetic.
// Any date works — this one is just easy to read in test output.
const NOW = new Date("2026-07-06T12:00:00Z").getTime();

test.describe("GuestSoftBanner — auth-aware visibility gate", () => {
  test("HIDDEN while auth is loading (never flash for signed-in users)", () => {
    // Regardless of user or dismiss state, ready === false means we
    // don't know yet, so we don't render.
    expect(shouldRenderGuestSoftBanner(false, false, "", NOW)).toBe(false);
    expect(shouldRenderGuestSoftBanner(false, true, "", NOW)).toBe(false);
    expect(shouldRenderGuestSoftBanner(false, false, "2020-01-01T00:00:00Z", NOW)).toBe(false);
  });

  test("HIDDEN when signed in (Google user should not see the upsell)", () => {
    // This is the exact bug the fix addresses.
    expect(shouldRenderGuestSoftBanner(true, true, "", NOW)).toBe(false);
    // Even if they'd dismissed before signing in, still hidden.
    expect(shouldRenderGuestSoftBanner(true, true, "2020-01-01T00:00:00Z", NOW)).toBe(false);
  });

  test("SHOWN for confirmed anonymous user who has never dismissed", () => {
    expect(shouldRenderGuestSoftBanner(true, false, "", NOW)).toBe(true);
  });

  test("HIDDEN for anonymous user during the 14-day dismiss window", () => {
    // Dismissed 1 hour ago — solidly inside the window.
    const oneHourAgo = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(shouldRenderGuestSoftBanner(true, false, oneHourAgo, NOW)).toBe(false);
    // Dismissed 13 days ago — still inside.
    const thirteenDaysAgo = new Date(NOW - 13 * DAY_MS).toISOString();
    expect(shouldRenderGuestSoftBanner(true, false, thirteenDaysAgo, NOW)).toBe(false);
  });

  test("SHOWN again after 14-day dismiss window expires", () => {
    // Dismissed 15 days ago — window has passed.
    const fifteenDaysAgo = new Date(NOW - 15 * DAY_MS).toISOString();
    expect(shouldRenderGuestSoftBanner(true, false, fifteenDaysAgo, NOW)).toBe(true);
  });

  test("SHOWN when the persisted dismiss timestamp is corrupt", () => {
    // A garbage value in storage must not permanently suppress the
    // banner. Fail open (show) rather than closed (hide forever).
    expect(shouldRenderGuestSoftBanner(true, false, "not-a-date", NOW)).toBe(true);
    expect(shouldRenderGuestSoftBanner(true, false, "", NOW)).toBe(true);
  });

  test("boundary — exactly 14 days ago is still HIDDEN (window is exclusive)", () => {
    const exactlyFourteen = new Date(NOW - 14 * DAY_MS).toISOString();
    // now - at === 14d → 14d > 14d is FALSE → suppress still active.
    expect(shouldRenderGuestSoftBanner(true, false, exactlyFourteen, NOW)).toBe(false);
    // One millisecond past 14d → suppress lifted.
    const justPast = new Date(NOW - 14 * DAY_MS - 1).toISOString();
    expect(shouldRenderGuestSoftBanner(true, false, justPast, NOW)).toBe(true);
  });
});
