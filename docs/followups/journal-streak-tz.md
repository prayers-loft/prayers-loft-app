# Follow-up: Server-Authoritative Streak (Build 17 GA Blocker)

**Status**: BLOCKER FOR GA · **Priority**: P0-for-App-Store-GA · **Owner**: unassigned
**Filed**: Build 14 polish pass (2026-07-01) as JOURNAL-STREAK-TZ · P2
**Promoted**: Post-Build-16 TestFlight sign-off · **New scope**: JOURNAL-STREAK-SERVER-AUTHORITY
**Superseded doc**: this file supersedes the original P2 timezone-only scope

---

## Product decision (baked in)

- **Build 16 (TestFlight)** ships with the **client-owned streak ledger**. This is acceptable.
  - Single-device beta testers are the primary TestFlight audience.
  - The client ledger is timezone-correct today (see `frontend/src/lib/streak.ts` + 21 unit tests).
  - The `active_days` union operator (`mergeDays(local, server)`) makes any future server-authoritative flip a **non-breaking change** for existing installs — the client will simply defer to the server value while its local ledger still contributes to the union during the offline window.

- **Build 17 (App Store GA target)** MUST ship with **server-authoritative streak for signed-in users**.
  - Cross-device sync (iPhone + iPad + Web-if-launched) is the primary user-facing benefit.
  - Enables downstream server features (weekly streak digest emails, streak-based push scheduling, admin dashboard, potential leaderboards).
  - Fixes the UTC anchor bug documented below without shipping the bug to production.

- **Guests remain client-owned.** No account required to earn a streak.
  - Preserves the "try it before you sign up" funnel for the spiritual-wellness use case.
  - No server round-trip needed for guest sessions → identical UX to Build 16 for anonymous users.
  - Sign-in promotes the guest ledger into the server via the existing `/api/account/migrate-guest` endpoint (see Migration path below).

---

## Original problem (kept for context)

`backend/auth.py:911` computes `StreakMeta.currentStreak` using `utcnow().date()`
as the "today" anchor — i.e., **UTC**, not the user's local calendar day. Today
this divergence is INVISIBLE because:

1. `StreakMeta` is only materialized at guest → account migration time.
2. The Journal always **re-derives** the streak on-device from timestamps,
   using the phone's local timezone. That client-side value is what users see.

## When this becomes a real bug

The server value ships to users the moment ANY of the following happen:

- Streaks move fully server-side (this doc — Build 17 target).
- Push notifications reference `streakMeta.currentStreak` server-side.
- An admin dashboard or export surfaces the field.
- Weekly digest emails reference the streak.

At that point, a user in Tokyo who reflects at 9pm JST (12:00 UTC) will see
their local day advance correctly, but the server-computed streak would tick
based on UTC midnight — causing spooky off-by-one streak counts every night.

Fixing this bug is a **prerequisite** to Build 17's server-authoritative flip,
and the fix is folded into the schema below (`activeDays[]` + `lastSeenTz`
persisted, `local_date` accepted on write).

---

## Build 17 required deliverables

### 1. Backend schema (new `user_streaks` collection or subdocument on `users`)

Field naming is deliberate — see Rationale below for why each shape was chosen.

```
user_streaks {
  user_id:            ObjectId | str        # FK to users._id
  currentStreak:      int                   # 0 when active_days is empty or today's local date is > 1 day ahead of last activity
  longestStreak:      int                   # monotonic; never decreases
  lastActivityDate:   str  ("YYYY-MM-DD")   # user's LOCAL date, not UTC. NOTE: renamed from lastReflectionDate — see below.
  activeDays:         [str] (["YYYY-MM-DD"])# sorted ascending; user's LOCAL dates
  lastSeenTz:         str  ("Asia/Tokyo")   # IANA tz from most recent write; used by background jobs to recompute per-user
  updatedAt:          datetime
  createdAt:          datetime
}
```

#### Rationale for the shape

- **`lastActivityDate`, not `lastReflectionDate`.** Prayers count toward the streak in Build 16+ (see `frontend/src/lib/streak-ledger.ts` — `recordActiveDay()` is called from BOTH prayer save (`app/(tabs)/prayer.tsx:~440`) and reflection save (`app/(tabs)/scripture.tsx:~354`)). Naming the field `lastReflectionDate` would be inaccurate and creates a bug where a prayer-only day is invisible to any server code reading this field. Rename intentional. Backend test fixtures referencing the old name need to be updated (grep: `backend/tests/test_phase2_auth_release.py:384`, `backend/auth.py:228`).
- **`activeDays: string[]` is REQUIRED** alongside the aggregate fields. Without it:
  - Timezone-correct recompute on the backend requires walking `reflections` + `saved_prayers` joins on every request. Expensive at scale.
  - Weekly digest email cron would have to duplicate this walk for every user every day.
  - `activeDays` is bounded — practically the last ~180 entries per user (older days don't affect the current/longest calculation once the streak resets) — so it's cheap to store and read.
- **`lastSeenTz`** enables background jobs (streak-reset cron, digest emails) to compute per-user without a live client round-trip. Refreshed on every write.

### 2. Backend endpoints

```
GET  /api/streak
    → Auth: JWT required (401 otherwise; guests handle client-side)
    → Response: { currentStreak, longestStreak, lastActivityDate, activeDays, lastSeenTz }

POST /api/streak/mark-active
    → Auth: JWT required
    → Body: { local_date: "2026-08-01", tz: "Asia/Tokyo" }
    → Server:
        - Validates local_date is within [today-1d, today+1d] relative to server's UTC now (soft
          anti-cheat: prevents replay attacks that would balloon the streak into the future/past)
        - If local_date not already in activeDays: append + resort
        - Recompute currentStreak + longestStreak using LOCAL DATE arithmetic (NOT utcnow().date())
        - Update lastActivityDate + lastSeenTz + updatedAt
    → Response: { currentStreak, longestStreak, lastActivityDate }

(Optional stretch for Build 17.1)
POST /api/streak/sync
    → Body: { active_days: ["YYYY-MM-DD", ...], tz: "..." }
    → Server: union client's active_days with existing; recompute; return.
    → Purpose: post-offline batch reconciliation.
```

### 3. Backend recompute algorithm (fixes UTC bug)

Replace the current `backend/auth.py:880-922` block that uses `utcnow().date()`
with a local-tz-aware version:

```python
from zoneinfo import ZoneInfo
from datetime import datetime, timedelta

def recompute_streak(active_days: list[str], tz_name: str) -> StreakMeta:
    tz = ZoneInfo(tz_name)
    today_local = datetime.now(tz).date()

    # Sort + dedupe + parse (all dates are USER-LOCAL, not UTC)
    parsed = sorted({datetime.strptime(d, "%Y-%m-%d").date() for d in active_days})
    if not parsed:
        return StreakMeta(currentStreak=0, longestStreak=0, lastActivityDate=None, activeDays=[])

    # Current streak: consecutive back-count from the tail; if last activity was neither today
    # nor yesterday, current = 0.
    current = 0
    if parsed[-1] == today_local or parsed[-1] == today_local - timedelta(days=1):
        current = 1
        for i in range(len(parsed) - 2, -1, -1):
            if parsed[i] == parsed[i + 1] - timedelta(days=1):
                current += 1
            else:
                break

    # Longest: single pass, count consecutive runs.
    longest = 1
    run = 1
    for i in range(1, len(parsed)):
        if parsed[i] == parsed[i - 1] + timedelta(days=1):
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    return StreakMeta(
        currentStreak=current,
        longestStreak=longest,
        lastActivityDate=parsed[-1].isoformat(),
        activeDays=[d.isoformat() for d in parsed],
    )
```

The parity oracle is `frontend/src/lib/streak.ts` — its 21 test scenarios in
`tests/tests/unit-streak.spec.ts` (DST forward, DST back, Tokyo, LA, NY,
London, cross-timezone travel) MUST all be mirrored as Python tests. If the
backend returns a different value than the client for the same `(active_days,
now, tz)` triple, that's a bug.

### 4. Frontend changes (Build 17)

Additive only — the existing client ledger stays in place as an offline mirror.

- **Prayer save + reflection save**: after `recordActiveDay()`, fire-and-forget
  `api.markActive({ local_date, tz })`. Failures do NOT block save UX (same
  contract as `recordActiveDay()` today — see `.catch()` handlers in
  `app/(tabs)/prayer.tsx` and `app/(tabs)/scripture.tsx`).

- **Journal load** (`app/reflections-history.tsx`):
  - If auth'd: `api.getStreak()` → prefer server's `currentStreak` /
    `longestStreak` for the display. Union `activeDays` into the local ledger
    so offline saves remain in the merged set.
  - If guest: unchanged — client-only, same as Build 16.

- **Cold start**: no change. Server streak is not a startup dependency.

- **Sign-out**: no change. Server value is per-user; on sign-out the client
  simply falls back to its own ledger.

### 5. Migration: existing client ledger → backend on sign-in

The infrastructure already exists via `/api/account/migrate-guest`
(see `backend/auth.py:~890-948` and `frontend/src/lib/account-migration.ts`).
Build 17 adds one field to the migration payload:

```
{
  guest_id: string,
  savedPrayers: [...],
  savedScriptures: [...],
  reflections: [...],
  devotionalHistory: [...],
  preferences: {...},
  streakMeta: {...},                             # existing
  # NEW in Build 17:
  streakLedger: {
    activeDays: ["YYYY-MM-DD", ...],             # from client's prayersloft_streak_ledger key
    lastSeenTz: "America/New_York",              # from client's Intl.DateTimeFormat().resolvedOptions().timeZone
  }
}
```

Server-side migration handler:
1. Union `streakLedger.activeDays` with any pre-existing `user_streaks.activeDays`
   for this account (rare — only happens when a user signs in on a second
   device where the account already has server-side history).
2. Call `recompute_streak(unioned_days, tz)` to produce the new
   `currentStreak` / `longestStreak` / `lastActivityDate`.
3. Persist `user_streaks` document. Return the new streak in the
   `MigrationResult.new_streak` field (already exists — see
   `backend/auth.py:MigrationResult.new_streak`).

Client-side, on receiving the migration result:
- Adopt server's `currentStreak` for display.
- **Keep** local `prayersloft_streak_ledger` — it becomes the offline mirror.
- Any offline save between sign-in and next successful `mark-active` remains
  captured by the ledger and gets replayed via `sync` (or on next foreground
  Journal load).

**Zero-loss guarantee**: because Build 17's server accepts the client's local
`activeDays[]` at migration time, no user should ever see their streak
"regress" during the flip. This is verified by:
- Existing unit tests in `tests/tests/unit-streak-ledger.spec.ts` covering
  the union semantics.
- New backend test suite that must be added: `test_migration_preserves_streak`
  (contract: for any pre-existing client ledger, `MigrationResult.new_streak.
  currentStreak` >= what the client would have computed alone).

---

## Effort estimate (Build 17)

| Slice | Effort | Notes |
|---|---|---|
| Backend schema + `user_streaks` collection + indexes | 0.5d | Add to `backend/server.py` index-create block |
| Backend `recompute_streak()` with tz support + parity tests vs client oracle | 1.5d | Port 21 client unit tests to Python; DST scenarios are the tricky ones |
| Backend endpoints `GET /streak` + `POST /streak/mark-active` + auth wiring | 1d | Follow the pattern of `/api/reflections` |
| Backend migration handler extension | 0.5d | Add `streakLedger` field to `MigrationPayload`, wire into recompute |
| Frontend `api.getStreak()` + `api.markActive()` + Journal integration | 1d | Behind a feature flag initially so we can A/B on TestFlight |
| Frontend offline replay queue (optional for v1) | 0.5–1d | Can defer to Build 17.1 |
| E2E parity test (sign-in on device A, save reflection on device B, verify streak syncs) | 0.5d | Requires 2 sessions or a curl-based fixture |
| **Total** | **~5–6 working days** | Single focused engineer; parallelizable between BE + FE |

## Non-goals for Build 17

- Streak leaderboards (out of scope — separate product decision)
- Weekly streak digest emails (out of scope — separate product decision; but Build 17's schema unblocks it)
- Cross-account streak transfer (out of scope — account merge is not currently a feature)
- Streak "freeze" or "streak recovery" mechanics (out of scope — spiritual-wellness apps are typically forgiving, but this is a product design decision)

---

## Related code (do not edit for Build 16)

- `backend/auth.py:228` — `StreakMeta` model. Add `activeDays` + `lastSeenTz`.
  Rename `lastReflectionDate` → `lastActivityDate`.
- `backend/auth.py:880-922` — Current UTC-anchored streak recompute at
  migration time. Replace with `recompute_streak(active_days, tz)`.
- `backend/tests/test_phase2_auth_release.py:384` — Existing test fixture
  references `lastReflectionDate`; update on rename.
- `frontend/src/lib/streak.ts` — Client-side reference implementation.
  Stays intact; becomes the parity oracle for the backend port.
- `frontend/src/lib/streak-ledger.ts` — Client-side ledger. Stays intact as
  the offline mirror.
- `frontend/src/lib/account-migration.ts` — Migration payload builder. Add
  `streakLedger: { activeDays, lastSeenTz }` to the payload.
- `tests/tests/unit-streak.spec.ts` — 21 scenarios; the parity oracle.
- `tests/tests/unit-streak-ledger.spec.ts` — Ledger semantics; stays intact.

---

## Explicit non-changes to Build 16

Build 16 remains **frozen at `1b7b612576e135d416dc1638e5cc5957e89a94c1`**. Nothing
in this document requires any Build 16 code change. All work described here
lands on `feature/server-streak` derived from post-Build-16 `main`.
