// Collects all guest-side AsyncStorage payloads and uploads them to the
// authenticated account exactly once. Idempotent via the stable `guest_id`.
import { storage } from "@/src/utils/storage";
import { getGuestIdentity } from "@/src/lib/guest-identity";
import { authFetch } from "@/src/lib/auth-client";

type SavedPrayer = {
  id?: string;
  text?: string;
  message?: string;
  scripture?: string;
  scripture_reference?: string;
  createdAt?: string;
  created_at?: string;
};

export type MigrationResult = {
  ok: boolean;
  already_migrated: boolean;
  migrated_counts: Record<string, number>;
  new_streak: { currentStreak: number; longestStreak: number; lastReflectionDate?: string | null };
  message: string;
};

const MIGRATED_FLAG = "prayersloft_migration_completed_v1";

async function readArray<T = any>(key: string): Promise<T[]> {
  try {
    const raw = await storage.getItem(key, "");
    if (!raw) return [];
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function readObject<T extends Record<string, any> = Record<string, any>>(
  key: string
): Promise<T | null> {
  try {
    const raw = await storage.getItem(key, "");
    if (!raw) return null;
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function normPrayer(p: SavedPrayer): { id: string; text: string; scripture?: string; createdAt?: string } | null {
  const text = (p.text || p.message || "").trim();
  if (!text) return null;
  return {
    id: p.id || `local-${Math.random().toString(36).slice(2)}`,
    text,
    scripture: p.scripture || p.scripture_reference || undefined,
    createdAt: p.createdAt || p.created_at || undefined,
  };
}

export async function buildMigrationPayload(): Promise<any> {
  const guest = await getGuestIdentity();
  const savedPrayersRaw = await readArray<SavedPrayer>("prayersloft_saved_prayers");
  const savedPrayers = savedPrayersRaw.map(normPrayer).filter(Boolean);
  const prefs = (await readObject("prayersloft_preferences_v1")) || {};
  const devo = await readObject<{ local_date?: string; verse_id?: string; devotional_text?: string }>(
    "prayersloft_daily_devotional_v1"
  );
  const devotionalHistory =
    devo && devo.local_date && devo.verse_id
      ? [
          {
            local_date: devo.local_date,
            verse_id: devo.verse_id,
            devotional_text: devo.devotional_text,
          },
        ]
      : [];
  return {
    guest_id: guest.id,
    savedPrayers,
    savedScriptures: [], // none in current local store; reserved for future
    reflections: [],     // reflections already live on the server (untagged); migration will re-tag by guest_id where supplied
    devotionalHistory,
    preferences: prefs,
    streakMeta: { currentStreak: 0, longestStreak: 0, lastReflectionDate: null },
  };
}

export async function runGuestMigration(): Promise<MigrationResult | null> {
  try {
    const flag = await storage.getItem(MIGRATED_FLAG, "");
    if (flag) return null; // already migrated on this device
    const payload = await buildMigrationPayload();
    const resp = await authFetch("/api/account/migrate-guest", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as MigrationResult;
    if (!resp.ok) {
      // 409 cross-user collision: do NOT set the migrated flag — user is on a borrowed device
      return null;
    }
    await storage.setItem(MIGRATED_FLAG, new Date().toISOString());
    return data;
  } catch {
    return null;
  }
}

export async function clearMigrationFlag(): Promise<void> {
  // Used by "Erase local data" so a fresh guest on the same device can re-migrate later.
  await storage.setItem(MIGRATED_FLAG, "");
}
