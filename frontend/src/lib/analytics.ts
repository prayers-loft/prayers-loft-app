// Lightweight on-device analytics buffer for Guest Mode.
//
// Purpose: when the user is invited to upgrade to a real account in Phase 2,
// we want to know which spiritual moment triggered the prompt (e.g. saving a
// prayer, hitting a 7-day streak, sharing a card). For now we just buffer
// these events locally; Phase 2/3 will wire them to a real analytics sink.
//
// All events respect the user's `analyticsOptIn` preference. If they have
// opted out, recording is a no-op.
import { storage } from "@/src/utils/storage";
import { getPrefs } from "@/src/lib/local-prefs";
import { getGuestId } from "@/src/lib/guest-identity";

export type AnalyticsEvent = {
  id: string;
  name: string;
  ts: string;
  guest_id: string;
  props?: Record<string, string | number | boolean | null>;
};

const KEY = "prayersloft_analytics_buffer_v1";
const MAX_BUFFER = 500;

async function readBuffer(): Promise<AnalyticsEvent[]> {
  const raw = await storage.getItem(KEY, "");
  if (!raw) return [];
  try {
    return JSON.parse(String(raw)) as AnalyticsEvent[];
  } catch {
    return [];
  }
}

async function writeBuffer(events: AnalyticsEvent[]): Promise<void> {
  const trimmed = events.slice(-MAX_BUFFER);
  await storage.setItem(KEY, JSON.stringify(trimmed));
}

export async function track(
  name: string,
  props?: Record<string, string | number | boolean | null>
): Promise<void> {
  try {
    const prefs = await getPrefs();
    if (!prefs.analyticsOptIn) return;
    const guest_id = await getGuestId();
    const event: AnalyticsEvent = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      ts: new Date().toISOString(),
      guest_id,
      props,
    };
    const buf = await readBuffer();
    buf.push(event);
    await writeBuffer(buf);
  } catch {
    // analytics must never break the app
  }
}

export async function getBufferedEvents(): Promise<AnalyticsEvent[]> {
  return readBuffer();
}

export async function clearBufferedEvents(): Promise<void> {
  await writeBuffer([]);
}

/** Conversion-trigger event names. Stable strings so Phase 2 can target them. */
export const ConversionTrigger = {
  PrayerSaved: "conv.prayer_saved",
  ReflectionSaved: "conv.reflection_saved",
  StreakMilestone: "conv.streak_milestone",
  Shared: "conv.share_succeeded",
  SettingsOpened: "conv.settings_opened",
  ManualUpgradeTap: "conv.manual_upgrade_tap",
} as const;
