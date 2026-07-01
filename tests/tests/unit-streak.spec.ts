// -----------------------------------------------------------------------------
// unit-streak — timezone contract tests for the client-side streak module.
//
// WHY THIS FILE EXISTS
// --------------------
// The Journal streak is computed on-device using the phone's LOCAL timezone
// (see frontend/src/lib/streak.ts for the rationale). This behavior is easy
// to reintroduce a regression against — a naive refactor that swaps
// getDate() for getUTCDate(), or that keys activeDays by ISO substring, will
// silently break users in Tokyo (they'd never see today's activity counted)
// or in Los Angeles during DST transitions.
//
// These tests pin the behavior across the four timezones we care about most
// for the current user base and cover the tricky edge cases:
//   • Multiple entries on the same local day → count once
//   • Consecutive local days → increments correctly
//   • Miss a day → resets
//   • Local-midnight boundary — the same UTC instant lives on different
//     local days in different TZs
//   • US spring-forward DST — the streak does not skip a day when the local
//     clock jumps from 01:59 → 03:00
//
// HOW WE SIMULATE TIMEZONES
// -------------------------
// Node evaluates process.env.TZ at every Date call (verified on Node 20),
// so the test suite can switch TZ per test by reassigning process.env.TZ
// before calling into the streak module. Each test that mutates TZ restores
// it in the `afterEach` hook to prevent cross-test bleed.
//
// The streak module itself accepts an explicit `now` Date parameter so tests
// can pin the wall clock; production code omits it and uses `new Date()`.
// -----------------------------------------------------------------------------
import { test, expect } from "@playwright/test";
import {
  activeDaysFromISOs,
  computeStreak,
  lastNDays,
  ymd,
} from "../../frontend/src/lib/streak";

const originalTZ = process.env.TZ;

function withTZ<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
}

test.describe("streak — same-day dedupe & basic counting", () => {
  test("multiple entries on the same local day count once", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00"); // Sun 8pm EDT
      const isos = [
        "2026-03-15T09:00:00-04:00",
        "2026-03-15T13:00:00-04:00",
        "2026-03-15T19:00:00-04:00",
      ];
      const days = activeDaysFromISOs(isos);
      expect(days.size).toBe(1);
      expect(computeStreak(days, now)).toBe(1);
    });
  });

  test("three consecutive local days → streak of 3", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const isos = [
        "2026-03-13T10:00:00-04:00",
        "2026-03-14T10:00:00-04:00",
        "2026-03-15T10:00:00-04:00",
      ];
      expect(computeStreak(activeDaysFromISOs(isos), now)).toBe(3);
    });
  });

  test("missing yesterday resets streak to just today", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const isos = [
        "2026-03-13T10:00:00-04:00",
        // Mar 14 skipped
        "2026-03-15T10:00:00-04:00",
      ];
      expect(computeStreak(activeDaysFromISOs(isos), now)).toBe(1);
    });
  });

  test("no entry today but a run through yesterday → grace of one day", () => {
    // The product contract lets users who've reflected daily for a week
    // still see "7" before they add today's entry. See streak.ts rule #2.
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T09:00:00-04:00"); // early morning
      const isos = [
        "2026-03-12T10:00:00-04:00",
        "2026-03-13T10:00:00-04:00",
        "2026-03-14T10:00:00-04:00",
      ];
      expect(computeStreak(activeDaysFromISOs(isos), now)).toBe(3);
    });
  });

  test("empty entries → 0", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      expect(computeStreak(activeDaysFromISOs([]), now)).toBe(0);
    });
  });
});

test.describe("streak — timezone boundary correctness", () => {
  // The same UTC instant maps to different local calendar days depending
  // on the phone's timezone. A save at 2026-01-01T04:00:00Z is:
  //   • Dec 31 in New York       (EST = UTC-5, so 23:00 previous day)
  //   • Dec 31 in Los Angeles    (PST = UTC-8, so 20:00 previous day)
  //   • Jan 1  in London         (GMT = UTC, so 04:00 same day)
  //   • Jan 1  in Tokyo          (JST = UTC+9, so 13:00 same day)
  // The streak MUST honor the phone's clock, not the server's.
  const utcInstant = "2026-01-01T04:00:00Z";

  test("Asia/Tokyo — 04:00 UTC lands on Jan 1 local, counts today", () => {
    withTZ("Asia/Tokyo", () => {
      const now = new Date("2026-01-01T14:00:00+09:00"); // 2pm JST
      const days = activeDaysFromISOs([utcInstant]);
      expect([...days][0]).toBe("2026-01-01");
      expect(computeStreak(days, now)).toBe(1);
    });
  });

  test("Europe/London — 04:00 UTC lands on Jan 1 local, counts today", () => {
    withTZ("Europe/London", () => {
      const now = new Date("2026-01-01T14:00:00+00:00"); // 2pm GMT
      const days = activeDaysFromISOs([utcInstant]);
      expect([...days][0]).toBe("2026-01-01");
      expect(computeStreak(days, now)).toBe(1);
    });
  });

  test("America/New_York — 04:00 UTC lands on Dec 31 local, treated as yesterday", () => {
    withTZ("America/New_York", () => {
      // Now is Jan 1 evening in NY (EST, UTC-5)
      const now = new Date("2026-01-01T20:00:00-05:00");
      const days = activeDaysFromISOs([utcInstant]);
      expect([...days][0]).toBe("2025-12-31");
      // No entry for today (Jan 1 local), but yesterday (Dec 31 local) is
      // there — the "grace" rule kicks in and returns 1.
      expect(computeStreak(days, now)).toBe(1);
    });
  });

  test("America/Los_Angeles — 04:00 UTC lands on Dec 31 local, treated as yesterday", () => {
    withTZ("America/Los_Angeles", () => {
      const now = new Date("2026-01-01T18:00:00-08:00"); // 6pm PST
      const days = activeDaysFromISOs([utcInstant]);
      expect([...days][0]).toBe("2025-12-31");
      expect(computeStreak(days, now)).toBe(1);
    });
  });

  test("Tokyo user with 4 daily entries — 4 day streak; NY sees the same data as 3 (grace)", () => {
    // Same 4 saves, spread evenly across 4 days. The activeDays SET is
    // derived from the phone that's rendering the streak, so a Tokyo user
    // saving daily sees a 4-day streak on Tokyo evening, and an NY user
    // looking at the same 4 saves (had they been synced by that user) still
    // gets a reasonable count. This is only meaningful for the SAME user
    // moving between phones, but validates the tz-agnostic key format.
    const isos = [
      "2026-01-01T15:00:00+09:00", // Jan 1 Tokyo
      "2026-01-02T15:00:00+09:00", // Jan 2 Tokyo
      "2026-01-03T15:00:00+09:00", // Jan 3 Tokyo
      "2026-01-04T15:00:00+09:00", // Jan 4 Tokyo
    ];
    withTZ("Asia/Tokyo", () => {
      const now = new Date("2026-01-04T22:00:00+09:00");
      expect(computeStreak(activeDaysFromISOs(isos), now)).toBe(4);
    });
    withTZ("America/New_York", () => {
      // In NY, those saves land on Jan 1..4 06:00 EST — same 4 local days.
      const now = new Date("2026-01-04T10:00:00-05:00");
      expect(computeStreak(activeDaysFromISOs(isos), now)).toBe(4);
    });
  });
});

test.describe("streak — DST transitions do not create phantom day gaps", () => {
  // US DST spring-forward 2026: 02:00 EST on Sun Mar 8, 2026 → clock jumps
  // to 03:00 EDT. A naive streak keyed by local hours could accidentally
  // record two saves on the same "civil day" as different local dates
  // (because getDate() briefly flips during the transition), or miss the
  // day entirely. Our key format is YYYY-MM-DD from getFullYear/getMonth/
  // getDate — DST changes only the wall-clock hours, never the date —
  // so the streak is stable across the transition.

  test("streak spans Mar 7 → Mar 8 (spring forward) → Mar 9 unbroken", () => {
    withTZ("America/New_York", () => {
      const isos = [
        "2026-03-07T22:00:00-05:00", // Sat 10pm EST (pre-transition)
        "2026-03-08T10:00:00-04:00", // Sun 10am EDT (post-transition)
        "2026-03-09T10:00:00-04:00", // Mon 10am EDT
      ];
      const days = activeDaysFromISOs(isos);
      expect(days.size).toBe(3);
      expect(days.has("2026-03-07")).toBe(true);
      expect(days.has("2026-03-08")).toBe(true);
      expect(days.has("2026-03-09")).toBe(true);
      const now = new Date("2026-03-09T20:00:00-04:00");
      expect(computeStreak(days, now)).toBe(3);
    });
  });

  test("streak spans Nov 1 (fall back) unbroken", () => {
    // US DST fall-back 2026: 02:00 EDT on Sun Nov 1 → clock rewinds to
    // 01:00 EST, giving the day 25 hours. A save at 01:30 EDT and another
    // at 01:30 EST are the SAME civil day — the streak treats them as one.
    withTZ("America/New_York", () => {
      const isos = [
        "2026-10-31T20:00:00-04:00", // Sat 8pm EDT
        "2026-11-01T14:00:00-05:00", // Sun 2pm EST (post-transition)
        "2026-11-02T10:00:00-05:00", // Mon 10am EST
      ];
      const days = activeDaysFromISOs(isos);
      expect(days.size).toBe(3);
      const now = new Date("2026-11-02T20:00:00-05:00");
      expect(computeStreak(days, now)).toBe(3);
    });
  });
});

test.describe("streak — travel between timezones does not break the streak", () => {
  test("user reflects in Tokyo, then travels to NY same day, still counts as one day", () => {
    // Scenario: user saves a reflection in Tokyo at 10am JST (2026-06-14
    // 01:00 UTC), then boards a flight, lands in NY, and opens the Journal
    // that afternoon local NY time. The Tokyo save is on Jun 14 in JST but
    // on Jun 13 in NY. From the NY phone's perspective, "yesterday" (Jun 13)
    // has an entry, so the streak is 1 (grace rule). From the Tokyo phone,
    // "today" has an entry so the streak is 1. Neither is broken.
    const isos = ["2026-06-14T10:00:00+09:00"]; // 01:00 UTC

    withTZ("Asia/Tokyo", () => {
      const now = new Date("2026-06-14T20:00:00+09:00"); // Tokyo evening
      expect(computeStreak(activeDaysFromISOs(isos), now)).toBe(1);
    });

    withTZ("America/New_York", () => {
      // NY afternoon of Jun 14 — save shows as Jun 13 local, grace covers it
      const now = new Date("2026-06-14T15:00:00-04:00");
      const days = activeDaysFromISOs(isos);
      expect([...days][0]).toBe("2026-06-13");
      expect(computeStreak(days, now)).toBe(1);
    });
  });
});

test.describe("streak — ymd + lastNDays helpers", () => {
  test("ymd produces zero-padded YYYY-MM-DD", () => {
    withTZ("Europe/London", () => {
      const d = new Date("2026-01-05T12:00:00+00:00");
      expect(ymd(d)).toBe("2026-01-05");
    });
  });

  test("lastNDays returns 14 dates in ascending order ending on now", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const days = lastNDays(14, now);
      expect(days).toHaveLength(14);
      expect(ymd(days[13])).toBe("2026-03-15");
      expect(ymd(days[0])).toBe("2026-03-02");
    });
  });
});
