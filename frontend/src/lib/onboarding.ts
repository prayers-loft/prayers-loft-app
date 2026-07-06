// Tiny helpers backing first-time UX gates:
//   - onboarding seen (once-only first-launch carousel)
//   - AI disclosure shown (once-only on first prayer)
//
// `storage` AND `react-native` (for DeviceEventEmitter) are imported lazily
// inside the storage-bound helpers so the pure helpers below (_isUnderTest,
// FIRST_ACTION_ROUTE, getFirstActionRoute) remain importable from Node-only
// unit tests without dragging in native modules. Same pattern as
// streak-ledger.ts, reminders.ts, and daily-devotional.ts.
async function _storage() {
  const mod = await import("@/src/utils/storage");
  return mod.storage;
}
async function _rn() {
  return await import("react-native");
}

const KEY_ONBOARDING = "prayersloft_onboarding_seen_v1";
const KEY_AI_DISCLOSURE = "prayersloft_ai_disclosure_seen_v1";

export const ONBOARDING_REPLAY_EVENT = "prayersloft:replay-onboarding";

/**
 * The route the app pushes the user toward after they finish onboarding.
 *
 * Product decision (Build 16 spec): the strongest single first action is
 * "Read today's verse" — it delivers value instantly, needs no input from
 * the user, works for signed-out guests, and demonstrates the core loop
 * (scripture → devotional → reflection) in one glance. Save-a-reflection
 * requires typing; generate-a-prayer needs a prompt; today's verse is
 * always there.
 *
 * Centralized here as a pure constant so the CTA route and the tests
 * stay in lock-step.
 */
export const FIRST_ACTION_ROUTE = "/(tabs)/scripture" as const;

export function getFirstActionRoute(): typeof FIRST_ACTION_ROUTE {
  return FIRST_ACTION_ROUTE;
}

export function _isUnderTest(): boolean {
  try {
    if (typeof navigator !== "undefined" && (navigator as { webdriver?: boolean }).webdriver === true) return true;
    if (typeof globalThis !== "undefined" && (globalThis as { __PRAYERSLOFT_SKIP_ONBOARDING__?: boolean }).__PRAYERSLOFT_SKIP_ONBOARDING__) return true;
  } catch {
    // ignore
  }
  return false;
}

export async function hasSeenOnboarding(): Promise<boolean> {
  if (_isUnderTest()) return true;
  try {
    const storage = await _storage();
    const v = await storage.getItem(KEY_ONBOARDING, "");
    return !!v;
  } catch {
    // Storage read failure MUST NOT force a fresh install experience on
    // an existing user, and MUST NOT block launch. We assume "seen" on
    // failure — a false negative once is far more disruptive than
    // occasionally missing the first-launch UX on a device that already
    // ran the app before.
    return true;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    const storage = await _storage();
    await storage.setItem(KEY_ONBOARDING, new Date().toISOString());
  } catch {
    // Onboarding must never block the app on write failure. We accept
    // that the user may see the carousel again on next launch and move on.
  }
}

export async function hasSeenAIDisclosure(): Promise<boolean> {
  if (_isUnderTest()) return true;
  try {
    const storage = await _storage();
    const v = await storage.getItem(KEY_AI_DISCLOSURE, "");
    return !!v;
  } catch {
    return true; // same fail-safe: never show disclosure twice on a storage flake
  }
}

export async function markAIDisclosureSeen(): Promise<void> {
  try {
    const storage = await _storage();
    await storage.setItem(KEY_AI_DISCLOSURE, new Date().toISOString());
  } catch {
    // ignore
  }
}

export async function resetFirstLaunchGates(): Promise<void> {
  try {
    const storage = await _storage();
    await storage.setItem(KEY_ONBOARDING, "");
    await storage.setItem(KEY_AI_DISCLOSURE, "");
  } catch {
    // ignore — developer tools only
  }
}

/**
 * Developer Tools — clear the once-only gates AND immediately re-trigger the
 * onboarding carousel without requiring a cold relaunch. Used by Settings →
 * Developer Tools → Replay Onboarding.
 */
export async function replayOnboarding(): Promise<void> {
  await resetFirstLaunchGates();
  try {
    const rn = await _rn();
    rn.DeviceEventEmitter.emit(ONBOARDING_REPLAY_EVENT);
  } catch {
    // ignore — developer tools only
  }
}
