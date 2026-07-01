// My Journal — read-only history of saved reflections.
//
// Single responsibility: browse and revisit previously saved reflections.
// All creation, editing, prompts, emotion-chips-as-input, and streaks live
// on the Scripture tab. This screen never offers a reflection editor.
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

type Reflection = {
  id: string;
  text: string;
  emotion?: string;
  prompt?: string;
  verse_id?: string;
  created_at: string;
  updated_at: string;
};

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

export default function MyReflectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [authExpired, setAuthExpired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listReflections();
      setEntries(res.reflections as Reflection[]);
      setAuthExpired(false);
    } catch (e) {
      console.warn("load reflections failed", e);
      const isAuthExpired = !!(e && typeof e === "object" && (e as any).isAuthExpired);
      if (isAuthExpired) {
        // Render the dedicated "please sign in" empty state instead of an
        // error toast. After refresh fell back to guest, the call would
        // have succeeded with an empty list — so this branch means the
        // user genuinely has no auth and the screen prefers a calm prompt
        // over a red toast.
        setAuthExpired(true);
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

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [entries]
  );

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
        <Text style={styles.headerTitle}>My Reflections</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Journal</Text>
          <Text style={styles.title}>My reflections</Text>
        </View>

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
        ) : sortedEntries.length === 0 ? (
          <View style={styles.emptyCard} testID="reflections-empty-state">
            <Ionicons name="journal-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>My Journal</Text>
            <Text style={styles.emptyText}>
              Your reflections will appear here as you spend time in God's Word.
            </Text>
            <Text style={styles.emptyHint}>
              Write your first reflection from today's Scripture.
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
            {sortedEntries.map((entry) => (
              <ReflectionRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() =>
                  setExpandedId((curr) => (curr === entry.id ? null : entry.id))
                }
                onDelete={() => handleDelete(entry.id)}
                deleting={deletingId === entry.id}
              />
            ))}
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
});
