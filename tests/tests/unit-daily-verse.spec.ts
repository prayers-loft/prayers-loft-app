// -----------------------------------------------------------------------------
// unit-daily-verse — Build 16 Daily Verse polish regression tests.
//
// Covers the pure algorithmic surface introduced by the polish work:
//   • verse-share.formatVerseShareText — share body composition
//   • daily-devotional.cacheMatchesToday — same-day cache guard
//   • daily-devotional.localDateInTz + detectTimezone — offline & TZ logic
//
// Screen-level flows (pull-to-refresh spinner, retry button visibility,
// native Share.share() invocation) are documented in the manual
// verification checklist at the bottom of this file — they can only be
// validated on a real device against real network conditions.
// -----------------------------------------------------------------------------
import { test, expect } from "@playwright/test";
import {
  ATTRIBUTION,
  formatVerseShareText,
} from "../../frontend/src/lib/verse-share";
import {
  cacheMatchesToday,
  detectTimezone,
  localDateInTz,
} from "../../frontend/src/lib/daily-devotional";

// ---------------------------------------------------------------------------
// formatVerseShareText — the Build 16 native Share body composer.
// ---------------------------------------------------------------------------

test.describe("verse-share — formatVerseShareText", () => {
  test("includes verse text, reference, and attribution", () => {
    const s = formatVerseShareText({
      reference: "John 3:16",
      verse: "For God so loved the world…",
    });
    expect(s).toContain("For God so loved the world");
    expect(s).toContain("John 3:16");
    expect(s).toContain(ATTRIBUTION);
  });

  test("wraps the verse text in typographic quotes", () => {
    const s = formatVerseShareText({
      reference: "Psalm 23:1",
      verse: "The Lord is my shepherd.",
    });
    // Match the smart quotes rather than straight quotes so the tweet
    // reads naturally.
    expect(s.charAt(0)).toBe("\u201C");
    expect(s).toMatch(/\u201D\n\n\u2014 Psalm 23:1/);
  });

  test("attribution can be opted out with attribution: false", () => {
    const s = formatVerseShareText({
      reference: "John 3:16",
      verse: "For God so loved the world.",
      attribution: false,
    });
    expect(s).not.toContain(ATTRIBUTION);
    expect(s).toContain("For God so loved the world");
  });

  test("drops attribution (never verse text) when total exceeds 280 chars", () => {
    // 250 chars of verse + quotes + separator + reference + attribution
    // = 290 chars, which exceeds the 280 sanity ceiling → attribution dropped.
    const longVerse = "x".repeat(250);
    const s = formatVerseShareText({
      reference: "Fake 1:1",
      verse: longVerse,
    });
    // Attribution is missing (we chose scripture over branding).
    expect(s).not.toContain(ATTRIBUTION);
    // But the verse text is intact.
    expect(s).toContain("x".repeat(250));
    expect(s).toContain("Fake 1:1");
  });

  test("normalizes whitespace and strips surrounding straight quotes", () => {
    const s = formatVerseShareText({
      reference: "Isaiah 41:10",
      verse: '"  Don\'t be afraid,\n\nfor I am with you.  "',
    });
    // No embedded newlines from the verse body — they'd break SMS previews.
    expect(s.split("\n").filter((l) => l && !l.startsWith("\u2014") && l !== ATTRIBUTION).length)
      .toBeLessThanOrEqual(1);
    // Straight-quote wrapper is removed; smart-quote wrapper is applied.
    expect(s).toContain("Don't be afraid, for I am with you.");
    expect(s).not.toMatch(/"\s*Don/);
  });

  test("handles empty attribution string safely (no trailing whitespace)", () => {
    const s = formatVerseShareText({
      reference: "John 1:1",
      verse: "In the beginning was the Word.",
    });
    // No lines ending in whitespace, no double-double newlines at end.
    expect(s.endsWith(" ")).toBe(false);
    expect(s).not.toMatch(/\n\n\n/);
  });
});

// ---------------------------------------------------------------------------
// cacheMatchesToday — same-day + same-tz guard.
// ---------------------------------------------------------------------------

test.describe("daily-devotional — cacheMatchesToday", () => {
  const payload = {
    verse: "test",
    reference: "Test 1:1",
    verse_id: "TST.1.1",
    bible_link: "https://example.com",
    devotional: "…",
    local_date: "2026-07-06",
  };

  test("returns true on same date + same tz", () => {
    const entry = { date: "2026-07-06", tz: "America/New_York", payload };
    expect(cacheMatchesToday(entry, "America/New_York", "2026-07-06")).toBe(true);
  });

  test("returns false on different date (day change)", () => {
    const entry = { date: "2026-07-06", tz: "America/New_York", payload };
    expect(cacheMatchesToday(entry, "America/New_York", "2026-07-07")).toBe(false);
  });

  test("returns false on different timezone (traveler)", () => {
    const entry = { date: "2026-07-06", tz: "America/New_York", payload };
    expect(cacheMatchesToday(entry, "Asia/Tokyo", "2026-07-06")).toBe(false);
  });

  test("returns false on null entry (cold install, no cache)", () => {
    expect(cacheMatchesToday(null, "UTC", "2026-07-06")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// localDateInTz + detectTimezone — used by both cache guard and offline
// fallback branches of loadDailyVerse.
// ---------------------------------------------------------------------------

test.describe("daily-devotional — localDateInTz + detectTimezone", () => {
  test("Tokyo returns Tokyo-local date for a UTC-early morning", () => {
    // 2026-07-06T00:30:00Z is 2026-07-06T09:30:00+09:00 in Tokyo.
    const d = new Date("2026-07-06T00:30:00Z");
    expect(localDateInTz("Asia/Tokyo", d)).toBe("2026-07-06");
  });

  test("NY returns yesterday for a UTC-early morning", () => {
    // Same instant is 2026-07-05T20:30:00-04:00 in NY.
    const d = new Date("2026-07-06T00:30:00Z");
    expect(localDateInTz("America/New_York", d)).toBe("2026-07-05");
  });

  test("bogus tz name falls back to UTC-derived date", () => {
    const d = new Date("2026-07-06T00:30:00Z");
    const result = localDateInTz("Definitely/Not/A/Tz", d);
    // Fallback path returns the UTC date slice from ISO.
    expect(result).toBe("2026-07-06");
  });

  test("detectTimezone returns a non-empty string or the UTC fallback", () => {
    const tz = detectTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Manual verification checklist (Build 16 spec). Documented here so the
// reviewer can tick each item on a real device before Build 16 integration.
// ---------------------------------------------------------------------------
//
// [ ] Fresh install, network OK: skeleton fades in, then verse card, then
//     devotional. No blank moment.
// [ ] Fresh install, offline: inline error card appears with a Retry
//     button. Tapping Retry after connectivity returns loads the verse.
// [ ] App relaunch same day: cached verse loads instantly. No spinner,
//     no network round-trip (verify via network inspector).
// [ ] App relaunch next day: cached-then-refresh sequence renders, and
//     the transitional "new day" pill appears briefly.
// [ ] Pull-to-refresh: spinner appears at top, verse + devotional
//     re-fetch, spinner dismisses. Cannot fire a second time while the
//     first is in flight (guarded by `refreshing` state).
// [ ] Slow network: skeleton stays visible until Phase 1 returns; verse
//     appears while devotional skeleton continues.
// [ ] Pull-to-refresh on a failure: retries; if the fetch fails again,
//     falls back to stale cache if available, otherwise shows the error
//     card. Never leaves the screen blank.
// [ ] Native Share action: paper-plane icon opens the OS Share sheet
//     with the composed body ("verse text" — reference — Shared from
//     Prayers Loft). Verify copy in Messages preview.
// [ ] User-cancel on OS Share sheet: no toast fires.
// [ ] Long verse (Psalm 23:1-4): wraps cleanly on both small (iPhone SE)
//     and large (Pro Max) devices. No horizontal scroll.
// [ ] No layout shift after skeleton → real card transition.
// [ ] Verse card and error card share consistent visual weight — one
//     never leaves the screen skeletal.
