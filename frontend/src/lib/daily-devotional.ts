// Timezone-aware daily devotional cache. Locks the devotional per local
// calendar day so refreshes, navigation, and reopens never regenerate.
import { storage } from "@/src/utils/storage";

export type DailyVersePayload = {
  verse: string;
  reference: string;
  verse_id: string;
  bible_link: string;
  devotional: string;
  local_date: string;
};

type CacheEntry = {
  date: string; // YYYY-MM-DD in local timezone
  tz: string;   // IANA timezone name
  payload: DailyVersePayload;
};

const CACHE_KEY = "prayersloft_daily_devotional_v1";

/** Resolves the device's IANA timezone, falling back to "UTC". */
export function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") return tz;
  } catch {
    // ignore
  }
  return "UTC";
}

/** Returns YYYY-MM-DD as the current calendar date in the given IANA timezone. */
export function localDateInTz(tz: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // ignore
  }
  // Final fallback: UTC
  const u = now.toISOString().slice(0, 10);
  return u;
}

export async function loadCachedDevotional(): Promise<CacheEntry | null> {
  try {
    const raw = await storage.getItem(CACHE_KEY, "");
    if (!raw) return null;
    const parsed = JSON.parse(raw as string) as CacheEntry;
    if (parsed && parsed.date && parsed.tz && parsed.payload) return parsed;
  } catch {
    // ignore
  }
  return null;
}

export async function saveCachedDevotional(entry: CacheEntry): Promise<void> {
  try {
    await storage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

/** True when cached entry is for the same local date AND same timezone. */
export function cacheMatchesToday(entry: CacheEntry | null, tz: string, date: string): boolean {
  return !!entry && entry.date === date && entry.tz === tz;
}
