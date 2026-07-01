# Follow-up: Backend Streak Timezone Support

**Status**: NOT BLOCKING · **Priority**: P2 · **Owner**: unassigned
**Filed**: Build 14 polish pass (2026-07-01)
**Ticket**: JOURNAL-STREAK-TZ

## Problem
`backend/auth.py:911` computes `StreakMeta.currentStreak` using `utcnow().date()`
as the "today" anchor — i.e., **UTC**, not the user's local calendar day. Today
this divergence is INVISIBLE because:

1. `StreakMeta` is only materialized at guest → account migration time.
2. The Journal always **re-derives** the streak on-device from timestamps,
   using the phone's local timezone. That client-side value is what users see.

## When this becomes a real bug
The server value ships to users the moment any of the following happen:

- Streaks move fully server-side (e.g., cross-device sync, leaderboards,
  weekly streak digest emails).
- Push notifications reference `streakMeta.currentStreak` server-side.
- An admin dashboard or export surfaces the field.

At that point, a user in Tokyo who reflects at 9pm JST (12:00 UTC) will see
their local day advance correctly, but the server-computed streak would tick
based on UTC midnight — causing spooky off-by-one streak counts every night.

## Required fix (when we get there)

1. Add `tz: str` or `local_date: str` parameter to any endpoint that reads
   or writes `StreakMeta.currentStreak` (mirror `/api/daily-verse`'s existing
   `tz`/`local_date` params).
2. In the streak recomputation loop:
   - Replace `today = utcnow().date()` with the user's LOCAL today derived
     from the passed tz.
   - Keep the sorted_dates loop as-is; day keys should be computed with the
     user's tz too (currently uses ISO substring `[:10]` which is UTC-slice —
     needs to shift to local before slicing).
3. Persist the user's last known tz on the user document so background jobs
   (streak-reset cron, digest emails) can compute per-user correctly.

## Contract already in place

The client-side streak module (`frontend/src/lib/streak.ts`) is the current
source of truth and is exhaustively tested (see `tests/tests/unit-streak.spec.ts`,
15 timezone scenarios including DST + travel). When the backend catches up,
its output must match the client output for a given (activeDays, now, tz)
triple — the unit test file can serve as an oracle for parity.

## Related code
- `backend/auth.py:880-922` — current UTC-anchored streak recompute.
- `frontend/src/lib/streak.ts` — client-side reference implementation.
- `tests/tests/unit-streak.spec.ts` — timezone contract tests.
