// My Journal — read-only history of saved reflections + streak card.
//
// Single responsibility: browse and revisit previously saved reflections,
// with the streak visualization at the top of the screen (restored in
// Build 14 after being accidentally lost when the old Reflections tab was
// deleted during the Bible Assistant nav refactor — the streak lived
// inside that removed file).
//
// Each row shows:
//   • date
//   • verse reference (if the reflection was attached to a verse)
//   • preview of the first few lines
//
// Tap a row to expand the full reflection inline. Tap again to collapse.
// Long-press (or the explicit Delete button) removes the entry, with a
// confirmation alert — this is a journal-management primitive, not creation.
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { colors, emotionColors, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { showToast } from "@/src/components/Toast";
import {
  getSavedPrayers,
  removeSavedPrayer,
  SavedPrayer,
} from "@/src/lib/local-store";

type Reflection = {
  id: string;
  text: string;
  emotion?: string;
  prompt?: string;
  verse_id?: string;
  created_at: string;
  updated_at: string;
};

// Merged card kind — we render reflections and saved prayers on the same
// time-sorted timeline (this restores the pre-refactor "Reflections + Saved
// Prayers" combined feed that lived on the old (tabs)/reflections.tsx before
// commit 41840ab deleted it). Kept as a discriminated union so the render
// branch never confuses the two shapes.
type FeedItem =
  | { kind: "reflection"; id: string; created_at: string; data: Reflection }
  | { kind: "prayer"; id: string; created_at: string; data: SavedPrayer };

// Light-weight verse_id → human reference mapping for the small library of
// daily verses. Falls back to the raw verse_id if unknown.
const VERSE_REF_LABELS: Record<string, string> = {
  "PSA.23.1": "Psalm 23:1",
  "JER.29.11": "Jeremiah 29:11",
  "PHP.4.6": "Philippians 4:6–7",
  "ISA.41.10": "Isaiah 41:10",
  "ROM.8.28": "Romans 8:28",
  "PRO.3.5": "Proverbs 3:5–6",
  "MAT.11.28": "Matthew 11:28",
  "PSA.46.10": "Psalm 46:10",
  "2CO.12.9": "2 Corinthians 12:9",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function verseReferenceFor(verse_id?: string): string | null {
  if (!verse_id) return null;
  return VERSE_REF_LABELS[verse_id] ?? verse_id;
}

// -----------------------------------------------------------------------------
// Streak — restored in Build 14.
//
// Prior to the nav refactor (commit 41840ab) the streak block lived on the
// old Reflections tab and computed itself client-side from the reflection
// list, keyed by *local-timezone* YYYY-MM-DD strings. That file was deleted
// when the tab was replaced by Bible Assistant and the streak went with it.
// The backend still computes streakMeta on every reflection save (see
// backend/auth.py:880-945) for signed-in users, but the app never rendered
// it after the refactor. This client-side computation restores the exact
// visual behavior and also keeps guest users covered (no auth required).
//
// Verified contract (backed by testing_agent iter 13):
//   * Streak keyed by user's LOCAL calendar day via new Date()/getDate()
//     — server timezone is irrelevant.
//   * activeDays is a Set<string> of YYYY-MM-DD keys, so multiple saves
//     on the same day only count once.
//   * The while-loop breaks the first day it doesn't find in activeDays,
//     so missing a day resets naturally.
//   * Entries come from the API on every screen focus, so restart-safety
//     is inherited from server persistence.
// -----------------------------------------------------------------------------
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeStreak(activeDays: Set<string>): number {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cursor = new Date(today);
  // If nothing was saved today, start counting from yesterday — this way a
  // user who reflected daily for a week still sees the 7 even before they
  // do today's entry.
  if (!activeDays.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(ymd(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function lastNDays(n: number): Date[] {
  const out: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d);
  }
  return out;
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function StreakBlock({
  streak,
  days,
  activeDays,
}: {
  streak: number;
  days: Date[];
  activeDays: Set<string>;
}) {
  const todayStr = ymd(new Date());
  const headline = streak === 0 ? "Begin today" : `${streak}`;
  const sub =
    streak === 0
      ? "A single reflection is enough to begin."
      : streak === 1
      ? "day streak"
      : "day streak";
  return (
    <View style={styles.streakBlock} testID="streak-card">
      <View style={styles.streakTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.streakLabel}>Your streak</Text>
          <View style={styles.streakHeadlineRow}>
            <Text style={styles.streakNumber}>{headline}</Text>
            {streak > 0 && <Text style={styles.streakUnit}>{sub}</Text>}
          </View>
          {streak === 0 && <Text style={styles.streakHint}>{sub}</Text>}
        </View>
        {streak >= 3 && (
          <View style={styles.flameBubble}>
            <Ionicons name="flame" size={20} color={colors.accent} />
          </View>
        )}
      </View>
      <View style={styles.streakRow} testID="streak-row">
        {days.map((d) => {
          const key = ymd(d);
          const active = activeDays.has(key);
          const isToday = key === todayStr;
          return (
            <View key={key} style={styles.streakCell}>
              <View
                style={[
                  styles.streakDot,
                  active && styles.streakDotActive,
                  isToday && !active && styles.streakDotToday,
                ]}
              />
              <Text style={[styles.streakDay, isToday && styles.streakDayToday]}>
                {WEEKDAY_LETTERS[d.getDay()]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function MyReflectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<Reflection[]>([]);
  const [prayers, setPrayers] = useState<SavedPrayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [authExpired, setAuthExpired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Saved prayers are stored client-side in AsyncStorage and do NOT depend
    // on auth. We always attempt to load them, even if the reflections call
    // 401s — otherwise a signed-out user with local prayers would see an
    // empty screen despite their data being intact on disk.
    let localPrayers: SavedPrayer[] = [];
    try {
      localPrayers = await getSavedPrayers();
    } catch (e) {
      console.warn("load saved prayers failed", e);
    }
    setPrayers(localPrayers);

    try {
      const res = await api.listReflections();
      setEntries(res.reflections as Reflection[]);
      setAuthExpired(false);
    } catch (e) {
      console.warn("load reflections failed", e);
      const isAuthExpired = !!(e && typeof e === "object" && (e as any).isAuthExpired);
      if (isAuthExpired) {
        // Session expired — reflections are unreachable. But saved prayers
        // live on-device, so if the user has any we still show the timeline
        // (with prayer entries only) rather than the "sign in" wall. The
        // wall is reserved for the truly-empty case where the user has
        // nothing local either.
        setAuthExpired(localPrayers.length === 0);
        setEntries([]);
      } else {
        showToast({
          variant: "error",
          title: "Couldn't load your journal",
          message: "Check your connection and try again.",
          duration: 5000,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Time-sorted merged feed: reflections + saved prayers on one timeline.
  // Both use ISO created_at strings so a string compare is a valid time sort.
  const feed: FeedItem[] = useMemo(() => {
    const refl: FeedItem[] = entries.map((r) => ({
      kind: "reflection" as const,
      id: r.id,
      created_at: r.created_at,
      data: r,
    }));
    const pr: FeedItem[] = prayers.map((p) => ({
      kind: "prayer" as const,
      id: p.id,
      created_at: p.created_at,
      data: p,
    }));
    return [...refl, ...pr].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [entries, prayers]);

  // Streak: derived from LOCAL-timezone YYYY-MM-DD keys of every saved
  // reflection AND every saved prayer — both count as spiritual practice
  // for the day. Guest users get this without any auth (prayers are local).
  const activeDays = useMemo(() => {
    const set = new Set<string>();
    for (const item of feed) {
      const d = new Date(item.created_at);
      if (!Number.isNaN(d.getTime())) set.add(ymd(d));
    }
    return set;
  }, [feed]);
  const streak = useMemo(() => computeStreak(activeDays), [activeDays]);
  const last14 = useMemo(() => lastNDays(14), []);

  const handleDelete = (id: string) => {
    Alert.alert(
      "Delete reflection?",
      "This reflection will be permanently removed from your journal. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(id);
            try {
              await api.deleteReflection(id);
              setEntries((prev) => prev.filter((e) => e.id !== id));
              if (expandedId === id) setExpandedId(null);
            } catch (e) {
              console.warn("delete reflection failed", e);
              showToast({
                variant: "error",
                title: "Couldn't delete",
                message: e instanceof Error ? e.message : "Please try again.",
                duration: 4000,
              });
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const handleDeletePrayer = (id: string) => {
    Alert.alert(
      "Remove saved prayer?",
      "This prayer will be removed from your journal on this device. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setDeletingId(id);
            try {
              const ok = await removeSavedPrayer(id);
              if (!ok) throw new Error("Storage write failed");
              setPrayers((prev) => prev.filter((p) => p.id !== id));
              if (expandedId === id) setExpandedId(null);
            } catch (e) {
              console.warn("delete prayer failed", e);
              showToast({
                variant: "error",
                title: "Couldn't remove",
                message: e instanceof Error ? e.message : "Please try again.",
                duration: 4000,
              });
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <ScreenBackground>
      <View style={[styles.headerRow, { paddingTop: insets.top + 14 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          testID="my-reflections-back-button"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>My Journal</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Journal</Text>
          <Text style={styles.title}>My Journal</Text>
        </View>

        {/* Streak card — restored in Build 14. Hidden while the initial
            fetch is in flight and when the session is fully expired
            (both of those states already own the entire viewport). */}
        {!loading && !authExpired && (
          <StreakBlock streak={streak} days={last14} activeDays={activeDays} />
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : authExpired ? (
          <View style={styles.emptyCard} testID="reflections-auth-expired">
            <Ionicons name="lock-closed-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Sign in to see your journal</Text>
            <Text style={styles.emptyText}>
              Your session has expired. Sign in again from Settings to access your saved reflections.
            </Text>
            <Pressable
              onPress={() => router.push("/settings" as any)}
              style={styles.emptyCta}
              testID="auth-expired-go-to-settings"
            >
              <Text style={styles.emptyCtaText}>Open Settings</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent} />
            </Pressable>
          </View>
        ) : feed.length === 0 ? (
          <View style={styles.emptyCard} testID="reflections-empty-state">
            <Ionicons name="journal-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>My Journal</Text>
            <Text style={styles.emptyText}>
              Your reflections and saved prayers will appear here as you spend time in God's Word.
            </Text>
            <Text style={styles.emptyHint}>
              Write your first reflection from today's Scripture, or save a prayer from the Prayer tab.
            </Text>
            <Pressable
              onPress={() => router.replace("/(tabs)/scripture" as any)}
              style={styles.emptyCta}
              testID="empty-go-to-scripture"
            >
              <Text style={styles.emptyCtaText}>Open Scripture</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {feed.map((item) =>
              item.kind === "reflection" ? (
                <ReflectionRow
                  key={`r-${item.id}`}
                  entry={item.data}
                  expanded={expandedId === item.id}
                  onToggle={() =>
                    setExpandedId((curr) => (curr === item.id ? null : item.id))
                  }
                  onDelete={() => handleDelete(item.id)}
                  deleting={deletingId === item.id}
                />
              ) : (
                <PrayerRow
                  key={`p-${item.id}`}
                  entry={item.data}
                  expanded={expandedId === item.id}
                  onToggle={() =>
                    setExpandedId((curr) => (curr === item.id ? null : item.id))
                  }
                  onDelete={() => handleDeletePrayer(item.id)}
                  deleting={deletingId === item.id}
                />
              )
            )}
          </View>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

function ReflectionRow({
  entry,
  expanded,
  onToggle,
  onDelete,
  deleting,
}: {
  entry: Reflection;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const verseRef = verseReferenceFor(entry.verse_id);
  const ec = entry.emotion && emotionColors[entry.emotion] ? emotionColors[entry.emotion] : null;
  return (
    <Pressable
      onPress={onToggle}
      style={styles.card}
      testID={`reflection-row-${entry.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open reflection from ${formatDate(entry.created_at)}`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.cardDate}>{formatDate(entry.created_at)}</Text>
          {verseRef && (
            <>
              <Text style={styles.cardDot}>·</Text>
              <Text style={styles.cardVerseRef} numberOfLines={1}>
                {verseRef}
              </Text>
            </>
          )}
        </View>
        {ec && entry.emotion ? (
          <View style={[styles.emotionTag, { backgroundColor: ec.bg }]}>
            <Text style={[styles.emotionTagText, { color: ec.text }]}>{entry.emotion}</Text>
          </View>
        ) : null}
      </View>

      <Text
        style={styles.cardText}
        numberOfLines={expanded ? undefined : 3}
      >
        {entry.text}
      </Text>

      {expanded && (
        <View style={styles.cardActions}>
          <Pressable
            onPress={onDelete}
            disabled={deleting}
            hitSlop={6}
            testID={`reflection-delete-${entry.id}`}
            accessibilityRole="button"
            accessibilityLabel="Delete this reflection"
          >
            {deleting ? (
              <ActivityIndicator color={colors.textTertiary} size="small" />
            ) : (
              <Text style={styles.deleteText}>Delete</Text>
            )}
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

// PrayerRow — renders a locally-saved prayer entry (from AsyncStorage). Uses
// the same shell as ReflectionRow so the merged feed reads as one journal
// timeline, but with a "Saved prayer" leaf-icon tag and an italic prayer body
// to visually distinguish AI-composed prayers from user-written reflections.
function PrayerRow({
  entry,
  expanded,
  onToggle,
  onDelete,
  deleting,
}: {
  entry: SavedPrayer;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.card, styles.cardPrayer]}
      testID={`prayer-row-${entry.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open saved prayer from ${formatDate(entry.created_at)}`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.prayerTag}>
            <Ionicons name="leaf-outline" size={11} color={colors.accent} />
            <Text style={styles.prayerTagText}>Saved prayer</Text>
          </View>
        </View>
        <Text style={styles.cardDate}>{formatDate(entry.created_at)}</Text>
      </View>

      {!!entry.request && (
        <Text style={styles.prayerRequest} numberOfLines={expanded ? undefined : 2}>
          &ldquo;{entry.request}&rdquo;
        </Text>
      )}
      <Text
        style={styles.prayerBody}
        numberOfLines={expanded ? undefined : 4}
      >
        {entry.prayer}
      </Text>
      {!!entry.verseReference && (
        <Text style={styles.prayerVerseRef}>{entry.verseReference}</Text>
      )}

      {expanded && (
        <View style={styles.cardActions}>
          <Pressable
            onPress={onDelete}
            disabled={deleting}
            hitSlop={6}
            testID={`prayer-delete-${entry.id}`}
            accessibilityRole="button"
            accessibilityLabel="Remove this saved prayer"
          >
            {deleting ? (
              <ActivityIndicator color={colors.textTertiary} size="small" />
            ) : (
              <Text style={styles.deleteText}>Remove</Text>
            )}
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.2,
  },
  scroll: { paddingHorizontal: 24, paddingTop: 8, gap: 14 },
  hero: { marginTop: 8, marginBottom: 14 },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: 24,
    color: colors.text,
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  loadingBox: { padding: 60, alignItems: "center" },
  emptyCard: {
    backgroundColor: colors.surface1,
    borderRadius: 22,
    padding: 36,
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  emptyTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  emptyText: {
    fontFamily: fonts.serif,
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 23,
  },
  emptyHint: {
    fontFamily: fonts.sans,
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 2,
  },
  emptyCta: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyCtaText: {
    fontFamily: fonts.sansMedium,
    color: colors.accent,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  list: { gap: 12, marginTop: 4 },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    padding: 18,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  cardDate: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.4,
  },
  cardDot: { color: colors.textTertiary, fontSize: 12 },
  cardVerseRef: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  emotionTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  emotionTagText: { fontFamily: fonts.sansSemibold, fontSize: 11 },
  cardText: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 15,
    lineHeight: 23,
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 6,
  },
  deleteText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: "#F8B8B8",
  },
  // ---------------------------------------------------------------------------
  // Saved-prayer card — restored in Build 14 alongside the streak card.
  //
  // Reuses `.card` shell for layout continuity with reflection rows but layers
  // a warm-gold tint (accentSoft) so the two entry kinds are visually distinct
  // in the merged feed. The prayer body is italic + serif to signal that the
  // AI composed it (as opposed to reflections, which the user wrote).
  // ---------------------------------------------------------------------------
  cardPrayer: {
    backgroundColor: colors.accentSoft,
  },
  prayerTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.surface2,
  },
  prayerTagText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 0.4,
  },
  prayerRequest: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  prayerBody: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    color: colors.text,
    fontSize: 15,
    lineHeight: 23,
  },
  prayerVerseRef: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.4,
    marginTop: 2,
  },
  // ---------------------------------------------------------------------------
  // Streak block — restored in Build 14. Styled to match the emptyCard so it
  // feels like a first-class Journal element rather than a bolt-on. Uses the
  // same surface1/surface2 palette + 22px radius as the empty state for
  // visual continuity when the list is empty *and* when the list is full.
  // ---------------------------------------------------------------------------
  streakBlock: {
    backgroundColor: colors.surface1,
    borderRadius: 22,
    padding: 20,
    gap: 16,
    marginTop: 4,
  },
  streakTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  streakLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  streakHeadlineRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  streakNumber: {
    fontFamily: fonts.sansSemibold,
    fontSize: 34,
    color: colors.text,
    letterSpacing: -0.6,
    lineHeight: 38,
  },
  streakUnit: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  streakHint: {
    fontFamily: fonts.serif,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  flameBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  streakRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 4,
  },
  streakCell: {
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  streakDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  streakDotActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  streakDotToday: {
    borderColor: colors.accent,
    borderWidth: 1.5,
  },
  streakDay: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  streakDayToday: {
    color: colors.accent,
    fontFamily: fonts.sansSemibold,
  },
});
