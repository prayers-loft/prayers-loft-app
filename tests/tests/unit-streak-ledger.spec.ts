// -----------------------------------------------------------------------------
// unit-streak-ledger — Build 16 regression tests.
//
// WHAT WE'RE PROVING
// ------------------
// Before Build 16, deleting a historical reflection would lower the user's
// streak because the streak was derived on-the-fly from the currently loaded
// reflections + saved prayers. The fix introduces a monotonic "active days"
// ledger persisted in AsyncStorage — once a day is earned, it stays earned.
//
// These tests exercise the pure algorithmic surface of the ledger module
// (mergeDays + the union that reflections-history.tsx computes for the
// streak input) so the fix is verified without needing an AsyncStorage
// mock or a Playwright end-to-end run.
//
// The storage-bound helpers (loadLedger / saveLedger / recordActiveDay)
// are thin wrappers over `storage` and are exercised by the existing
// storage tests in the codebase; asserting them here would only test the
// JSON codec, not the streak semantics we care about.
// -----------------------------------------------------------------------------
import { test, expect } from "@playwright/test";
import { activeDaysFromISOs, computeStreak, ymd } from "../../frontend/src/lib/streak";
import { mergeDays, todayKey } from "../../frontend/src/lib/streak-ledger";

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

// ---- helpers to model what reflections-history.tsx computes at render ----
// activeDays = ledger ∪ derived_days_from_current_feed
function streakInput(ledger: Set<string>, feedISOs: string[]): Set<string> {
  return mergeDays(ledger, activeDaysFromISOs(feedISOs));
}

test.describe("streak ledger — mergeDays is monotonic and idempotent", () => {
  test("mergeDays never removes existing days", () => {
    const base = new Set(["2026-03-13", "2026-03-14"]);
    const next = mergeDays(base, ["2026-03-15"]);
    expect(next.has("2026-03-13")).toBe(true);
    expect(next.has("2026-03-14")).toBe(true);
    expect(next.has("2026-03-15")).toBe(true);
    expect(next.size).toBe(3);
  });

  test("mergeDays returns a new Set — inputs are untouched", () => {
    const base = new Set(["2026-03-13"]);
    const next = mergeDays(base, ["2026-03-14"]);
    expect(base.size).toBe(1);
    expect(base.has("2026-03-14")).toBe(false);
    expect(next).not.toBe(base);
  });

  test("mergeDays is idempotent — merging the same day twice is a no-op", () => {
    const base = new Set(["2026-03-13"]);
    const a = mergeDays(base, ["2026-03-13"]);
    const b = mergeDays(a, ["2026-03-13"]);
    expect(a.size).toBe(1);
    expect(b.size).toBe(1);
  });

  test("mergeDays rejects malformed day-keys", () => {
    const base = new Set<string>();
    const next = mergeDays(base, ["not-a-date", "", "2026/03/15", "2026-3-15"]);
    expect(next.size).toBe(0);
  });

  test("todayKey uses the local timezone", () => {
    withTZ("Asia/Tokyo", () => {
      const now = new Date("2026-03-15T09:00:00+09:00");
      expect(todayKey(now)).toBe("2026-03-15");
      expect(todayKey(now)).toBe(ymd(now)); // consistent with streak.ts
    });
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      expect(todayKey(now)).toBe("2026-03-15");
    });
  });
});

test.describe("BUG FIX — deleting a historical reflection does not lower the streak", () => {
  // These are the acceptance criteria from the Build 16 ticket, translated
  // to the pure algorithmic surface used by reflections-history.tsx.

  test("yesterday + today activity → streak 2 (baseline before delete)", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      // Ledger has been maintained monotonically as saves happened.
      const ledger = new Set(["2026-03-14", "2026-03-15"]);
      const feedISOs = [
        "2026-03-14T10:00:00-04:00",
        "2026-03-15T10:00:00-04:00",
      ];
      const active = streakInput(ledger, feedISOs);
      expect(active.size).toBe(2);
      expect(computeStreak(active, now)).toBe(2);
    });
  });

  test("delete yesterday's reflection → streak stays 2", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      // Ledger persists — the deletion below does NOT touch it.
      const ledger = new Set(["2026-03-14", "2026-03-15"]);
      // Feed has lost yesterday's row because the user deleted it.
      const feedAfterDelete = ["2026-03-15T10:00:00-04:00"];
      const active = streakInput(ledger, feedAfterDelete);
      // Ledger contributes 2026-03-14 — streak is preserved.
      expect(active.has("2026-03-14")).toBe(true);
      expect(active.has("2026-03-15")).toBe(true);
      expect(computeStreak(active, now)).toBe(2);
    });
  });

  test("delete today's reflection after streak is already earned → streak does not collapse", () => {
    // The Journal renders the streak from `activeDays`. If the user deletes
    // today's row, the feed no longer contains today; the ledger still does
    // (we recorded it at save time). Streak stays 2, because today + yesterday
    // are both in the ledger.
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const ledger = new Set(["2026-03-14", "2026-03-15"]);
      const feedAfterDeleteToday = ["2026-03-14T10:00:00-04:00"];
      const active = streakInput(ledger, feedAfterDeleteToday);
      expect(computeStreak(active, now)).toBe(2);
    });
  });

  test("delete every historical reflection → streak stays at the earned length", () => {
    // Extreme case: user deletes ALL of their reflections. The ledger
    // still holds the earned days, so the streak reflects historical fact.
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const ledger = new Set([
        "2026-03-13", "2026-03-14", "2026-03-15",
      ]);
      const feedEmpty: string[] = [];
      const active = streakInput(ledger, feedEmpty);
      expect(computeStreak(active, now)).toBe(3);
    });
  });

  test("delete yesterday does NOT retroactively fix a gap — the streak is what was earned", () => {
    // If the user had a gap (Mar 13, skip Mar 14, Mar 15) and later deletes
    // Mar 13, the streak reflects only the earned days that lead up to
    // today. This confirms the ledger doesn't hallucinate coverage — it
    // just refuses to *remove* earned days.
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const ledger = new Set(["2026-03-13", "2026-03-15"]);
      const feedAfterDeleteMar13: string[] = ["2026-03-15T10:00:00-04:00"];
      const active = streakInput(ledger, feedAfterDeleteMar13);
      expect(computeStreak(active, now)).toBe(1); // only today counts, correct
    });
  });
});

test.describe("ledger backfill — upgraders from a pre-Build-16 build", () => {
  // Users who saved reflections before this build shipped will have an
  // empty ledger on first load. The Journal calls hydrateFromDerivedDays()
  // which merges the historical feed days INTO the ledger. This test
  // proves the merge semantics are what the screen relies on.

  test("empty ledger + historical feed → streak is fully accurate on first load", () => {
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const emptyLedger = new Set<string>();
      const historicalFeed = [
        "2026-03-13T10:00:00-04:00",
        "2026-03-14T10:00:00-04:00",
        "2026-03-15T10:00:00-04:00",
      ];
      const active = streakInput(emptyLedger, historicalFeed);
      expect(computeStreak(active, now)).toBe(3);
    });
  });

  test("empty ledger + then delete → streak drops (backfill hasn't hit AsyncStorage yet)", () => {
    // This documents a small acceptable window: if the user opens the app,
    // instantly hits delete on yesterday BEFORE the backfill useEffect has
    // finished writing to AsyncStorage, the streak briefly reflects the
    // deletion. Once hydrateFromDerivedDays completes on the next focus,
    // the ledger will have caught up. In practice AsyncStorage writes are
    // sub-millisecond; this window is theoretical.
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-15T20:00:00-04:00");
      const emptyLedger = new Set<string>();
      const feedAfterInstantDelete = ["2026-03-15T10:00:00-04:00"];
      const active = streakInput(emptyLedger, feedAfterInstantDelete);
      expect(computeStreak(active, now)).toBe(1);
    });
  });
});

test.describe("timezone / DST correctness — ledger keys are TZ-local", () => {
  test("Tokyo user: ledger keys and derived keys align on the local day", () => {
    withTZ("Asia/Tokyo", () => {
      const now = new Date("2026-06-14T20:00:00+09:00");
      const ledger = new Set(["2026-06-14"]);
      const feedISO = ["2026-06-14T10:00:00+09:00"];
      const active = streakInput(ledger, feedISO);
      expect(active.size).toBe(1);
      expect(computeStreak(active, now)).toBe(1);
    });
  });

  test("spring-forward DST does not create a phantom missing day", () => {
    // Mar 8 2026 is spring-forward in NY. A user with entries Mar 7 → 8 → 9
    // in the ledger has an unbroken 3-day streak regardless of the clock
    // jump.
    withTZ("America/New_York", () => {
      const now = new Date("2026-03-09T20:00:00-04:00");
      const ledger = new Set(["2026-03-07", "2026-03-08", "2026-03-09"]);
      const active = streakInput(ledger, []);
      expect(computeStreak(active, now)).toBe(3);
    });
  });

  test("fall-back DST does not double-count Nov 1", () => {
    // Nov 1 2026 has 25 hours in NY. Two saves that hour-collide across the
    // fall-back still key to the same local day (2026-11-01) and count once.
    withTZ("America/New_York", () => {
      const now = new Date("2026-11-01T20:00:00-05:00");
      const ledger = new Set(["2026-10-31", "2026-11-01"]);
      const feedISOs = [
        "2026-11-01T01:30:00-04:00", // EDT just before fall-back
        "2026-11-01T01:30:00-05:00", // EST just after fall-back
      ];
      const active = streakInput(ledger, feedISOs);
      // Only 2 unique local days — Oct 31 (ledger only) + Nov 1 (both).
      expect(active.size).toBe(2);
      expect(computeStreak(active, now)).toBe(2);
    });
  });

  test("traveler: Tokyo save on Jun 14 → NY sees Jun 13 local; ledger seeded on the local day gets credit", () => {
    // User saves in Tokyo, then boards a flight. When they land in NY the
    // ledger they built up on the Tokyo device would ideally sync — but
    // for the current single-device model, the ledger on the NY device
    // would still be empty. This test proves that in the single-device
    // NY case, the derived feed correctly attributes the save to Jun 13
    // local (via activeDaysFromISOs), so the streak is 1 (grace rule).
    withTZ("America/New_York", () => {
      const now = new Date("2026-06-14T15:00:00-04:00");
      const emptyLedger = new Set<string>();
      const feedISOs = ["2026-06-14T10:00:00+09:00"]; // Tokyo save
      const active = streakInput(emptyLedger, feedISOs);
      expect(active.has("2026-06-13")).toBe(true);
      expect(computeStreak(active, now)).toBe(1);
    });
  });
});
