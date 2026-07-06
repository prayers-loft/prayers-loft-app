// -----------------------------------------------------------------------------
// Streak Ledger — persistent "days on which the user acted" store.
//
// WHY THIS EXISTS
// ---------------
// Before Build 16, the Journal streak was computed on-the-fly from the
// currently-loaded reflections + saved prayers. That meant:
//
//     User saves yesterday + today  → streak = 2
//     User deletes yesterday's row  → streak drops to 1
//
// which is a broken product contract: a streak is a record of historical
// consistency. Deleting old content should never rob the user of credit
// they already earned.
//
// This module fixes that by keeping a **monotonic** set of local YYYY-MM-DD
// day-keys in AsyncStorage. Once a day is added, it stays until the user
// signs out or clears app data. Deletion of a reflection does NOT touch
// this ledger.
//
// The streak on the Journal screen is now computed from
//     activeDays = ledger ∪ derived_days_from_current_feed
// where the union serves two purposes:
//   1. Backfills the ledger for users upgrading from a previous build who
//      have existing reflections but no ledger yet — see mergeDays().
//   2. Keeps things fresh in the current render pass without waiting for
//      the async ledger read to complete.
//
// DESIGN NOTES
// ------------
// • Single-user-per-device model: one global storage key. Sign-out clears
//   local app data separately (see auth-api.ts), so no per-user namespacing
//   is required for the current product surface.
// • Local timezone: day-keys are the YYYY-MM-DD from ymd() in
//   src/lib/streak.ts, which reads the device's local clock — this matches
//   the contract the streak module already documents.
// • Format on disk: JSON array (not Set — Sets don't JSON-serialize), sorted
//   ascending for readability and deterministic diffs.
// • Failure modes: storage errors are warned but never thrown — the streak
//   silently falls back to the derived-only path if the ledger is
//   unreachable.
// -----------------------------------------------------------------------------
import { ymd } from "@/src/lib/streak";

export const STREAK_LEDGER_KEY = "prayersloft_streak_ledger";

// The `storage` helper wraps AsyncStorage + SecureStore, both of which drag
// in native-only modules that can't be loaded by Node during pure unit tests.
// We reach for it via a lazy dynamic import inside each storage-bound
// function so the pure helpers below (mergeDays, todayKey) remain importable
// from Node-only test environments.
async function _storage() {
  const mod = await import("@/src/utils/storage");
  return mod.storage;
}

// ---------- Pure helpers (no storage — safe to unit-test) ----------

/**
 * Merge a batch of local YYYY-MM-DD day-keys into an existing ledger set.
 * Returns a new Set (never mutates inputs). Idempotent: calling twice with
 * the same input yields the same result. Monotonic: never removes days.
 *
 * This is the ONLY way days should enter the ledger. Do not expose a
 * "removeDay" helper — the whole point of this module is that once a day
 * is earned it stays earned.
 */
export function mergeDays(existing: Set<string>, incoming: Iterable<string>): Set<string> {
  const out = new Set(existing);
  for (const d of incoming) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      out.add(d);
    }
  }
  return out;
}

/**
 * Convenience: build the local day-key for a given Date (default = now).
 * Kept here to avoid callers importing both this module and streak.ts.
 */
export function todayKey(now: Date = new Date()): string {
  return ymd(now);
}

// ---------- Storage-bound operations ----------

/** Load the persisted ledger, returning an empty Set on any failure. */
export async function loadLedger(): Promise<Set<string>> {
  try {
    const storage = await _storage();
    const raw = await storage.getItem(STREAK_LEDGER_KEY, "");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw as string) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return mergeDays(new Set(), parsed as string[]);
  } catch (e) {
    // Never propagate — a corrupt ledger must not brick the app.
    console.warn("[streak-ledger] load failed", e);
    return new Set();
  }
}

/**
 * Persist the ledger to storage as a sorted JSON array. Returns true on
 * success. On failure we warn but do not throw — the in-memory streak is
 * still correct for this session; we'll retry next time.
 */
export async function saveLedger(days: Set<string>): Promise<boolean> {
  try {
    const storage = await _storage();
    const sorted = [...days].sort();
    return await storage.setItem(STREAK_LEDGER_KEY, JSON.stringify(sorted));
  } catch (e) {
    console.warn("[streak-ledger] save failed", e);
    return false;
  }
}

/**
 * Record today's local day as active. Idempotent — calling repeatedly on
 * the same day is a no-op after the first successful write. Callers wire
 * this into every qualifying save action (reflection, prayer).
 */
export async function recordActiveDay(now: Date = new Date()): Promise<Set<string>> {
  const key = todayKey(now);
  const current = await loadLedger();
  if (current.has(key)) return current;
  const next = mergeDays(current, [key]);
  await saveLedger(next);
  return next;
}

/**
 * Merge a batch of days into the persisted ledger. Used on Journal load to
 * backfill from existing reflections/prayers so users upgrading from a
 * previous build get their historical days folded in without needing to
 * take a new qualifying action.
 *
 * Returns the resulting Set so callers can use it directly for the current
 * render pass without waiting for a subsequent loadLedger() round-trip.
 */
export async function hydrateFromDerivedDays(derived: Iterable<string>): Promise<Set<string>> {
  const current = await loadLedger();
  const next = mergeDays(current, derived);
  if (next.size !== current.size) {
    await saveLedger(next);
  }
  return next;
}

/**
 * Reset the ledger. Used only by explicit sign-out / clear-app-data flows.
 * Not part of the streak-earning API surface — grep for this before adding
 * new callers.
 */
export async function clearLedger(): Promise<boolean> {
  try {
    const storage = await _storage();
    return await storage.removeItem(STREAK_LEDGER_KEY);
  } catch (e) {
    console.warn("[streak-ledger] clear failed", e);
    return false;
  }
}
