// Reflections tab — journaling with prompts, emotion chips, saved entries.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, emotionColors, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { getSavedPrayers, removeSavedPrayer, SavedPrayer } from "@/src/lib/local-store";

const DAILY_PROMPTS = [
  "What's one thing you noticed today that felt like grace?",
  "Where did you feel God's nearness — or distance — today?",
  "What are you carrying that you'd like to set down?",
  "Name one quiet gift from this week.",
  "What word would describe your soul right now?",
  "Who would you like to pray for, and why?",
  "What scripture has been sitting with you lately?",
  "Where do you need courage tomorrow?",
  "What's one thing you're grateful for that you usually overlook?",
  "If God spoke a single sentence to you today, what might it be?",
];

const EMOTIONS = ["Grateful", "Hopeful", "Anxious", "Peaceful", "Confused", "Joyful", "Tired", "Seeking"] as const;
type Emotion = (typeof EMOTIONS)[number];

// --- Streak helpers ---
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeStreak(activeDays: Set<string>): number {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Allow the streak to count from yesterday if user hasn't journaled today yet.
  let cursor = new Date(today);
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

type ServerEntry = { id: string; text: string; emotion?: string; prompt?: string; created_at: string; updated_at: string };

type CombinedEntry =
  | ({ kind: "reflection" } & ServerEntry)
  | { kind: "prayer"; id: string; text: string; prayer: string; created_at: string; verseReference?: string };

export default function ReflectionsScreen() {
  const params = useLocalSearchParams<{ prompt?: string }>();
  const [entries, setEntries] = useState<ServerEntry[]>([]);
  const [savedPrayers, setSavedPrayers] = useState<SavedPrayer[]>([]);
  const [text, setText] = useState("");
  const [emotion, setEmotion] = useState<Emotion | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const todayPrompt = useMemo(() => {
    if (params.prompt) return params.prompt;
    const start = new Date(new Date().getFullYear(), 0, 0);
    const diff = (Date.now() - start.getTime()) / 86400000;
    return DAILY_PROMPTS[Math.floor(diff) % DAILY_PROMPTS.length];
  }, [params.prompt]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [serverRes, local] = await Promise.all([api.listReflections(), getSavedPrayers()]);
      setEntries(serverRes.reflections);
      setSavedPrayers(local);
    } catch (e) {
      console.warn("load reflections failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSave = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.updateReflection(editingId, text.trim(), emotion ?? undefined);
      } else {
        await api.createReflection(text.trim(), emotion ?? undefined, todayPrompt);
      }
      setText("");
      setEmotion(null);
      setEditingId(null);
      await load();
    } catch (e) {
      console.warn("save reflection failed", e);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (entry: ServerEntry) => {
    setText(entry.text);
    setEmotion((entry.emotion as Emotion) ?? null);
    setEditingId(entry.id);
  };

  const handleDelete = (id: string) => {
    Alert.alert("Delete reflection?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteReflection(id);
            await load();
          } catch (e) {
            console.warn("delete failed", e);
          }
        },
      },
    ]);
  };

  const handleDeletePrayer = (id: string) => {
    Alert.alert("Remove saved prayer?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeSavedPrayer(id);
          await load();
        },
      },
    ]);
  };

  const combined: CombinedEntry[] = useMemo(() => {
    const refl: CombinedEntry[] = entries.map((e) => ({ kind: "reflection" as const, ...e }));
    const pray: CombinedEntry[] = savedPrayers.map((p) => ({
      kind: "prayer" as const,
      id: p.id,
      text: p.request,
      prayer: p.prayer,
      created_at: p.created_at,
      verseReference: p.verseReference,
    }));
    return [...refl, ...pray].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [entries, savedPrayers]);

  // Build set of active days (any reflection or saved prayer) for streak + calendar.
  const activeDays = useMemo(() => {
    const set = new Set<string>();
    for (const c of combined) {
      const d = new Date(c.created_at);
      if (!Number.isNaN(d.getTime())) set.add(ymd(d));
    }
    return set;
  }, [combined]);

  const streak = useMemo(() => computeStreak(activeDays), [activeDays]);
  const last14 = useMemo(() => lastNDays(14), []);

  return (
    <ScreenBackground>
      <ScreenHeader />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Reflections</Text>

        <StreakCard streak={streak} days={last14} activeDays={activeDays} />

        <View style={styles.promptCard} testID="daily-prompt">
          <Text style={styles.promptLabel}>Today's Prompt</Text>
          <Text style={styles.promptText}>{todayPrompt}</Text>
        </View>

        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Begin writing…"
          placeholderTextColor="rgba(250,248,243,0.35)"
          style={styles.input}
          testID="reflection-input"
        />

        <View style={styles.chipsWrap} testID="emotion-chips">
          {EMOTIONS.map((em) => {
            const c = emotionColors[em];
            const active = emotion === em;
            return (
              <Pressable
                key={em}
                onPress={() => setEmotion(active ? null : em)}
                style={[
                  styles.chip,
                  { borderColor: c.border, backgroundColor: active ? c.bg : "transparent" },
                  active && { borderWidth: 1.5 },
                ]}
                testID={`emotion-chip-${em}`}
              >
                <Text style={[styles.chipText, { color: c.text }]}>{em}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleSave}
          disabled={!text.trim() || saving}
          style={[styles.saveBtn, (!text.trim() || saving) && styles.saveBtnDisabled]}
          testID="save-reflection-button"
        >
          {saving ? (
            <ActivityIndicator color={colors.bgTop} />
          ) : (
            <Text style={styles.saveBtnText}>{editingId ? "Update Reflection" : "Save Reflection"}</Text>
          )}
        </Pressable>

        {editingId && (
          <Pressable
            onPress={() => {
              setText("");
              setEmotion(null);
              setEditingId(null);
            }}
            style={styles.cancelLink}
            testID="cancel-edit-button"
          >
            <Text style={styles.cancelLinkText}>Cancel edit</Text>
          </Pressable>
        )}

        <Text style={styles.sectionLabel}>Your Reflections</Text>

        {loading && combined.length === 0 ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />
        ) : combined.length === 0 ? (
          <View style={styles.emptyCard} testID="empty-state">
            <Text style={styles.emptyText}>Your reflections will appear here.</Text>
          </View>
        ) : (
          combined.map((entry) =>
            entry.kind === "reflection" ? (
              <ReflectionCard
                key={`r-${entry.id}`}
                entry={entry}
                onEdit={() => handleEdit(entry)}
                onDelete={() => handleDelete(entry.id)}
              />
            ) : (
              <PrayerEntryCard
                key={`p-${entry.id}`}
                entry={entry}
                onDelete={() => handleDeletePrayer(entry.id)}
              />
            )
          )
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

function ReflectionCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: { id: string; text: string; emotion?: string; created_at: string };
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ec = entry.emotion && emotionColors[entry.emotion] ? emotionColors[entry.emotion] : null;
  const [expanded, setExpanded] = useState(false);
  const isLong = entry.text.length > 220 || (entry.text.match(/\n/g)?.length ?? 0) >= 4;
  return (
    <View style={styles.entryCard} testID={`reflection-card-${entry.id}`}>
      <View style={styles.entryHeader}>
        {ec && entry.emotion ? (
          <View style={[styles.entryChip, { borderColor: ec.border, backgroundColor: ec.bg }]}>
            <Text style={[styles.entryChipText, { color: ec.text }]}>{entry.emotion}</Text>
          </View>
        ) : (
          <View />
        )}
        <Text style={styles.entryDate}>{formatDate(entry.created_at)}</Text>
      </View>
      <Text style={styles.entryText} numberOfLines={expanded ? undefined : 5}>{entry.text}</Text>
      {isLong && (
        <Pressable onPress={() => setExpanded((v) => !v)} testID={`toggle-${entry.id}`}>
          <Text style={styles.showMore}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      )}
      <View style={styles.entryActions}>
        <Pressable onPress={onEdit} testID={`edit-${entry.id}`}>
          <Text style={styles.entryAction}>Edit</Text>
        </Pressable>
        <Pressable onPress={onDelete} testID={`delete-${entry.id}`}>
          <Text style={[styles.entryAction, styles.entryActionDanger]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PrayerEntryCard({
  entry,
  onDelete,
}: {
  entry: { id: string; text: string; prayer: string; created_at: string; verseReference?: string };
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = entry.prayer.length > 220 || (entry.prayer.match(/\n/g)?.length ?? 0) >= 5;
  return (
    <View style={[styles.entryCard, styles.entryCardPrayer]} testID={`prayer-saved-card-${entry.id}`}>
      <View style={styles.entryHeader}>
        <View style={styles.prayerTag}>
          <Text style={styles.prayerTagText}>🕊️ Saved prayer</Text>
        </View>
        <Text style={styles.entryDate}>{formatDate(entry.created_at)}</Text>
      </View>
      {!!entry.text && <Text style={styles.entryRequest} numberOfLines={2}>"{entry.text}"</Text>}
      <Text style={styles.entryPrayer} numberOfLines={expanded ? undefined : 6}>{entry.prayer}</Text>
      {isLong && (
        <Pressable onPress={() => setExpanded((v) => !v)} testID={`toggle-prayer-${entry.id}`}>
          <Text style={styles.showMore}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      )}
      {!!entry.verseReference && <Text style={styles.entryRef}>{entry.verseReference}</Text>}
      <View style={styles.entryActions}>
        <Pressable onPress={onDelete} testID={`delete-prayer-${entry.id}`}>
          <Text style={[styles.entryAction, styles.entryActionDanger]}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function StreakCard({
  streak,
  days,
  activeDays,
}: {
  streak: number;
  days: Date[];
  activeDays: Set<string>;
}) {
  const todayStr = ymd(new Date());
  const headline =
    streak === 0
      ? "Begin your streak today"
      : streak === 1
      ? "1 day streak"
      : `${streak} day streak`;
  const subline =
    streak === 0
      ? "A single reflection is enough to begin."
      : streak < 3
      ? "A quiet beginning. Keep going."
      : streak < 7
      ? "Faithful daily presence. Beautiful."
      : "A sustained practice of stillness.";
  return (
    <View style={styles.streakCard} testID="streak-card">
      <View style={styles.streakHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.streakLabel}>Your Streak</Text>
          <Text style={styles.streakHeadline}>{headline}</Text>
          <Text style={styles.streakSub}>{subline}</Text>
        </View>
        <View style={styles.streakIconWrap}>
          <Ionicons
            name={streak >= 3 ? "flame" : "leaf-outline"}
            size={26}
            color={streak >= 3 ? colors.gold : colors.textSecondary}
          />
        </View>
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

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingBottom: 64, gap: 14 },
  eyebrow: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginTop: 8 },
  promptCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    gap: 8,
  },
  promptLabel: { fontFamily: fonts.sansSemibold, fontSize: 10, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase" },
  promptText: { fontFamily: fonts.serif, color: colors.ivory, fontSize: 17, lineHeight: 25 },
  input: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    color: colors.ivory,
    fontFamily: fonts.sans,
    fontSize: 16,
    minHeight: 130,
    textAlignVertical: "top",
    lineHeight: 24,
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontFamily: fonts.sansSemibold, fontSize: 13 },
  saveBtn: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { fontFamily: fonts.sansBold, color: colors.bgTop, fontSize: 15, letterSpacing: 0.3 },
  cancelLink: { alignItems: "center", paddingVertical: 6 },
  cancelLinkText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.textSecondary },
  sectionLabel: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginTop: 16 },
  emptyCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 28,
    alignItems: "center",
  },
  emptyText: { fontFamily: fonts.serif, color: colors.textSecondary, fontSize: 15 },
  entryCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  entryCardPrayer: { borderColor: "rgba(201,168,76,0.25)" },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entryChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  entryChipText: { fontFamily: fonts.sansSemibold, fontSize: 11 },
  prayerTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(201,168,76,0.15)", borderWidth: 1, borderColor: "rgba(201,168,76,0.3)" },
  prayerTagText: { fontFamily: fonts.sansSemibold, fontSize: 11, color: colors.gold },
  entryDate: { fontFamily: fonts.sans, fontSize: 12, color: colors.textMuted },
  entryText: { fontFamily: fonts.serif, color: colors.ivory, fontSize: 15, lineHeight: 22 },
  entryRequest: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  entryPrayer: { fontFamily: fonts.serifItalic, fontStyle: "italic", color: colors.ivory, fontSize: 15, lineHeight: 22 },
  entryRef: { fontFamily: fonts.sansSemibold, fontSize: 12, color: colors.gold },
  showMore: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.gold, marginTop: 4 },
  streakCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(201,168,76,0.25)",
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  streakHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  streakLabel: { fontFamily: fonts.sansSemibold, fontSize: 10, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginBottom: 4 },
  streakHeadline: { fontFamily: fonts.sansBold, fontSize: 22, color: colors.ivory, lineHeight: 28, letterSpacing: -0.3 },
  streakSub: { fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  streakIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(201,168,76,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  streakRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  streakCell: { alignItems: "center", gap: 6, flex: 1 },
  streakDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(250,248,243,0.12)",
  },
  streakDotActive: {
    backgroundColor: colors.gold,
  },
  streakDotToday: {
    borderWidth: 1.5,
    borderColor: colors.gold,
    backgroundColor: "transparent",
  },
  streakDay: { fontFamily: fonts.sansMedium, fontSize: 10, color: colors.textMuted },
  streakDayToday: { color: colors.gold, fontFamily: fonts.sansSemibold },
  entryActions: { flexDirection: "row", justifyContent: "flex-end", gap: 18, marginTop: 4 },
  entryAction: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.gold },
  entryActionDanger: { color: "#f8a8a8" },
});
