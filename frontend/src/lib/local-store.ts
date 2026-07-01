// Local storage keys for saved prayers (per spec: prayersloft_ prefix).
import { storage } from "@/src/utils/storage";

const SAVED_PRAYERS_KEY = "prayersloft_saved_prayers";
const AMBIENT_KEY = "prayersloft_ambient_enabled";

export type SavedPrayer = {
  id: string;
  request: string;
  reflection: string;
  prayer: string;
  verseReference?: string;
  bibleLink?: string;
  created_at: string;
};

export async function getSavedPrayers(): Promise<SavedPrayer[]> {
  const raw = await storage.getItem(SAVED_PRAYERS_KEY, "");
  if (!raw) return [];
  try {
    return JSON.parse(raw as string) as SavedPrayer[];
  } catch {
    return [];
  }
}

export async function addSavedPrayer(p: SavedPrayer): Promise<boolean> {
  const existing = await getSavedPrayers();
  const next = [p, ...existing];
  // storage.setItem returns false when the underlying AsyncStorage call fails
  // (quota exceeded, keychain locked, disk full, etc.). We propagate that
  // signal to callers so the UI can surface a real error toast instead of
  // silently marking the prayer as "Saved" while nothing was written.
  return await storage.setItem(SAVED_PRAYERS_KEY, JSON.stringify(next));
}

export async function removeSavedPrayer(id: string): Promise<boolean> {
  const existing = await getSavedPrayers();
  const next = existing.filter((p) => p.id !== id);
  return await storage.setItem(SAVED_PRAYERS_KEY, JSON.stringify(next));
}

export async function getAmbientEnabled(): Promise<boolean> {
  const v = await storage.getItem(AMBIENT_KEY, false);
  return Boolean(v);
}

export async function setAmbientEnabled(enabled: boolean): Promise<void> {
  await storage.setItem(AMBIENT_KEY, enabled);
}
