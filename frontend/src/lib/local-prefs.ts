// User preferences stored locally on-device.
//
// These survive app restarts, device restarts, and offline launches. When
// the user upgrades to an account (Phase 2), these get pushed to the server
// as the source of truth, then sync back down.
import { storage } from "@/src/utils/storage";

export type AccentChoice = "sand" | "sunrise" | "sage";
export type ScriptureTranslation = "NLT" | "ESV" | "NIV" | "KJV";

export type Preferences = {
  // Notifications (placeholder — wiring up native push is a Phase 2/3 build).
  notificationsEnabled: boolean;
  notificationsDailyTime: string; // "HH:MM" 24h, local-time.
  // Appearance.
  accent: AccentChoice;
  // Ambient.
  ambientDefaultOn: boolean;
  // Scripture.
  preferredTranslation: ScriptureTranslation;
  // Share defaults.
  defaultShareAspect: "portrait" | "square" | "story";
  // Privacy.
  analyticsOptIn: boolean;
};

export const DEFAULT_PREFS: Preferences = {
  notificationsEnabled: false,
  // 8:00 PM local — matches the product spec for the daily reminder default.
  // Users can change this from Settings, and the value is persisted locally.
  notificationsDailyTime: "20:00",
  accent: "sand",
  ambientDefaultOn: false,
  preferredTranslation: "NLT",
  defaultShareAspect: "portrait",
  analyticsOptIn: true,
};

const KEY = "prayersloft_preferences_v1";

let cache: Preferences | null = null;

export async function getPrefs(): Promise<Preferences> {
  if (cache) return cache;
  const raw = await storage.getItem(KEY, "");
  if (!raw) {
    cache = { ...DEFAULT_PREFS };
    return cache;
  }
  try {
    const parsed = JSON.parse(String(raw)) as Partial<Preferences>;
    cache = { ...DEFAULT_PREFS, ...parsed };
    return cache;
  } catch {
    cache = { ...DEFAULT_PREFS };
    return cache;
  }
}

export async function updatePrefs(patch: Partial<Preferences>): Promise<Preferences> {
  const current = await getPrefs();
  const next = { ...current, ...patch };
  cache = next;
  await storage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function resetPrefs(): Promise<Preferences> {
  cache = { ...DEFAULT_PREFS };
  await storage.setItem(KEY, JSON.stringify(cache));
  return cache;
}

/**
 * Invalidate the in-memory cache without touching storage.
 *
 * Used by destructive flows (e.g. wipeAllGuestData) that clear the
 * storage layer directly. Without this, the next read returns stale
 * values from the cache for ~1 render, surfacing as a P2 UI bug where
 * "Erase Local Data" appears to not have worked. Calling this right
 * after the storage clear forces the next getPrefs() to re-read from
 * storage (which now returns "" and falls back to DEFAULT_PREFS).
 */
export function resetPrefsCache(): void {
  cache = null;
}
