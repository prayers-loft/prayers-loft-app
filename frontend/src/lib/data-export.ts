// Data export / backup utility for Guest Mode users.
//
// Produces a single JSON blob containing every piece of locally-persisted
// guest data. On native we'd share this as a file; on web we trigger a
// browser download. Users can keep this file as a self-service backup until
// Phase 2 adds real cloud sync.
import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { storage } from "@/src/utils/storage";
import { getSavedPrayers } from "@/src/lib/local-store";
import { getGuestIdentity } from "@/src/lib/guest-identity";
import { getPrefs } from "@/src/lib/local-prefs";
import { loadCachedDevotional } from "@/src/lib/daily-devotional";
import { getBufferedEvents } from "@/src/lib/analytics";

export type GuestExport = {
  schema: "prayersloft.guest_export.v1";
  exported_at: string;
  guest: { id: string; createdAt: string };
  preferences: Awaited<ReturnType<typeof getPrefs>>;
  saved_prayers: Awaited<ReturnType<typeof getSavedPrayers>>;
  cached_devotional: Awaited<ReturnType<typeof loadCachedDevotional>>;
  analytics_events: Awaited<ReturnType<typeof getBufferedEvents>>;
  reflections_note: string;
};

export async function buildGuestExport(): Promise<GuestExport> {
  const [guest, preferences, saved_prayers, cached_devotional, analytics_events] =
    await Promise.all([
      getGuestIdentity(),
      getPrefs(),
      getSavedPrayers(),
      loadCachedDevotional(),
      getBufferedEvents(),
    ]);
  return {
    schema: "prayersloft.guest_export.v1",
    exported_at: new Date().toISOString(),
    guest,
    preferences,
    saved_prayers,
    cached_devotional,
    analytics_events,
    reflections_note:
      "Text reflections are stored server-side and will be migrated automatically when you create an account.",
  };
}

export async function exportGuestData(): Promise<"shared" | "copied" | "downloaded" | "failed"> {
  try {
    const blob = await buildGuestExport();
    const text = JSON.stringify(blob, null, 2);

    if (Platform.OS === "web") {
      try {
        // eslint-disable-next-line no-undef
        const a = document.createElement("a");
        // eslint-disable-next-line no-undef
        a.href = "data:application/json;charset=utf-8," + encodeURIComponent(text);
        a.download = `prayers-loft-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        return "downloaded";
      } catch {
        await Clipboard.setStringAsync(text);
        return "copied";
      }
    }

    try {
      await Share.share({
        title: "Prayers Loft backup",
        message: text,
      });
      return "shared";
    } catch {
      await Clipboard.setStringAsync(text);
      return "copied";
    }
  } catch (e) {
    console.warn("exportGuestData failed", e);
    return "failed";
  }
}

/** Danger zone: wipe everything except the guest_id so streaks etc. reset. */
export async function wipeAllGuestData(): Promise<void> {
  await storage.setItem("prayersloft_saved_prayers", JSON.stringify([]));
  await storage.setItem("prayersloft_analytics_buffer_v1", JSON.stringify([]));
  await storage.setItem("prayersloft_preferences_v1", "");
  // Cached devotional uses its own key inside daily-devotional.ts; clear that too.
  await storage.setItem("prayersloft_daily_devotional_cache_v1", "");
}
