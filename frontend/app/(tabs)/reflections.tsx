// Reflections. Modern minimal journaling with elegant streak visualization.
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useEffect, useRef } from "react";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, emotionColors, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { getSavedPrayers, removeSavedPrayer, SavedPrayer } from "@/src/lib/local-store";
import { ShareImageModal, ShareKind } from "@/src/components/ShareImageModal";
import { getShareExcerpt } from "@/src/lib/share-excerpt";
import { PRAYER_TEMPLATES, PrayerTemplate } from "@/src/components/PrayerShareCard";
import { ConversionTrigger, track } from "@/src/lib/analytics";
import { requestUpgradePrompt } from "@/src/components/UpgradePromptHost";

const DAILY_PROMPTS = [
  "What's one thing you noticed today that felt like grace?",
  "Where did you feel God's nearness, or distance, today?",
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

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function computeStreak(activeDays: Set<string>): number {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cursor = new Date(today);
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
  const fade = useRef(new Animated.Value(0)).current;

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
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
    } catch (e) {
      console.warn("load reflections failed", e);
    } finally {
      setLoading(false);
    }
  }, [fade]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSave = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const chars = text.trim().length;
      if (editingId) await api.updateReflection(editingId, text.trim(), emotion ?? undefined);
      else await api.createReflection(text.trim(), emotion ?? undefined, todayPrompt);
      setText("");
      setEmotion(null);
      setEditingId(null);
      await load();
      if (!editingId) {
        track(ConversionTrigger.ReflectionSaved, { chars, has_emotion: !!emotion });
      }
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
      { text: "Delete", style: "destructive", onPress: async () => { try { await api.deleteReflection(id); await load(); } catch (e) { console.warn(e); } } },
    ]);
  };

  const handleDeletePrayer = (id: string) => {
    Alert.alert("Remove saved prayer?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => { await removeSavedPrayer(id); await load(); } },
    ]);
  };

  // ---- Share saved prayer ----------------------------------------------
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePayload, setSharePayload] = useState<ShareKind | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const handleSharePrayer = async (entry: { id: string; prayer: string; verseReference?: string }) => {
    if (sharingId) return;
    setSharingId(entry.id);
    try {
      const excerpt = await getShareExcerpt(entry.prayer, "Prayer");
      const tpl: PrayerTemplate = PRAYER_TEMPLATES[Math.floor(Math.random() * PRAYER_TEMPLATES.length)];
      setSharePayload({
        kind: "prayer",
        prayer: excerpt,
        fullText: entry.prayer,
        verseReference: entry.verseReference,
        defaultTemplate: tpl,
      });
      setShareOpen(true);
    } catch (e) {
      console.warn("share saved-prayer prep failed", e);
    } finally {
      setSharingId(null);
    }
  };

  const combined: CombinedEntry[] = useMemo(() => {
    const refl: CombinedEntry[] = entries.map((e) => ({ kind: "reflection" as const, ...e }));
    const pray: CombinedEntry[] = savedPrayers.map((p) => ({
      kind: "prayer" as const, id: p.id, text: p.request, prayer: p.prayer, created_at: p.created_at, verseReference: p.verseReference,
    }));
    return [...refl, ...pray].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [entries, savedPrayers]);

  const activeDays = useMemo(() => {
    const set = new Set<string>();
    for (const c of combined) {
      const d = new Date(c.created_at);
      if (!Number.isNaN(d.getTime())) set.add(ymd(d));
    }
    return set;
  }, [combined]);

  const streak = useMemo(() => computeStreak(activeDays), [activeDays]);

  // Trigger #2: 7-day streak milestone. Fires once (throttled by upgrade-prompt state).
  useEffect(() => {
    if (streak >= 7) {
      track(ConversionTrigger.StreakMilestone, { streak });
      requestUpgradePrompt("seven_day_streak");
    }
  }, [streak]);
  const last14 = useMemo(() => lastNDays(14), []);

  return (
    <ScreenBackground>
      <ScreenHeader />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={32}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Reflections</Text>
          <Text style={styles.title}>Quiet thoughts.</Text>
        </View>

        <StreakBlock streak={streak} days={last14} activeDays={activeDays} />

        {/* Prompt — borderless, italic */}
        <View style={styles.promptBlock}>
          <Text style={styles.promptLabel}>Today's prompt</Text>
          <Text style={styles.promptText}>{todayPrompt}</Text>
        </View>

        {/* Input */}
        <View style={styles.inputWrap}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Begin writing…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            testID="reflection-input"
          />
        </View>

        {/* Emotion chips */}
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
                  { backgroundColor: active ? c.bg : colors.surface1 },
                  active && { borderColor: c.border, borderWidth: 1 },
                ]}
                testID={`emotion-chip-${em}`}
              >
                <Text style={[styles.chipText, active && { color: c.text }]}>{em}</Text>
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
          {saving ? <ActivityIndicator color={colors.textOnAccent} /> : <Text style={styles.saveBtnText}>{editingId ? "Update reflection" : "Save reflection"}</Text>}
        </Pressable>

        {editingId && (
          <Pressable onPress={() => { setText(""); setEmotion(null); setEditingId(null); }} style={styles.cancelLink} testID="cancel-edit-button">
            <Text style={styles.cancelLinkText}>Cancel edit</Text>
          </Pressable>
        )}

        <Text style={styles.sectionLabel}>Your reflections</Text>

        {loading && combined.length === 0 ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : combined.length === 0 ? (
          <View style={styles.emptyCard} testID="empty-state">
            <Ionicons name="journal-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyText}>Your reflections will appear here.</Text>
          </View>
        ) : (
          <Animated.View style={{ opacity: fade, gap: 12 }}>
            {combined.map((entry) =>
              entry.kind === "reflection" ? (
                <ReflectionCard key={`r-${entry.id}`} entry={entry} onEdit={() => handleEdit(entry)} onDelete={() => handleDelete(entry.id)} />
              ) : (
                <PrayerEntryCard
                  key={`p-${entry.id}`}
                  entry={entry}
                  onDelete={() => handleDeletePrayer(entry.id)}
                  onShare={() => handleSharePrayer(entry)}
                  sharing={sharingId === entry.id}
                />
              )
            )}
          </Animated.View>
        )}
      </KeyboardAwareScrollView>

      <ShareImageModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        payload={sharePayload}
      />
    </ScreenBackground>
  );
}

function StreakBlock({ streak, days, activeDays }: { streak: number; days: Date[]; activeDays: Set<string> }) {
  const todayStr = ymd(new Date());
  const headline = streak === 0 ? "Begin today" : `${streak}`;
  const sub = streak === 0 ? "A single reflection is enough to begin." : streak === 1 ? "day streak" : "day streak";
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
              <View style={[styles.streakDot, active && styles.streakDotActive, isToday && !active && styles.streakDotToday]} />
              <Text style={[styles.streakDay, isToday && styles.streakDayToday]}>{WEEKDAY_LETTERS[d.getDay()]}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ReflectionCard({ entry, onEdit, onDelete }: { entry: { id: string; text: string; emotion?: string; created_at: string }; onEdit: () => void; onDelete: () => void }) {
  const ec = entry.emotion && emotionColors[entry.emotion] ? emotionColors[entry.emotion] : null;
  const [expanded, setExpanded] = useState(false);
  const isLong = entry.text.length > 220 || (entry.text.match(/\n/g)?.length ?? 0) >= 4;
  return (
    <View style={styles.entryCard} testID={`reflection-card-${entry.id}`}>
      <View style={styles.entryHeader}>
        {ec && entry.emotion ? (
          <View style={[styles.entryChip, { backgroundColor: ec.bg }]}>
            <Text style={[styles.entryChipText, { color: ec.text }]}>{entry.emotion}</Text>
          </View>
        ) : <View />}
        <Text style={styles.entryDate}>{formatDate(entry.created_at)}</Text>
      </View>
      <Text style={styles.entryText} numberOfLines={expanded ? undefined : 5}>{entry.text}</Text>
      {isLong && (
        <Pressable onPress={() => setExpanded((v) => !v)} testID={`toggle-${entry.id}`}>
          <Text style={styles.showMore}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      )}
      <View style={styles.entryActions}>
        <Pressable onPress={onEdit} testID={`edit-${entry.id}`}><Text style={styles.entryAction}>Edit</Text></Pressable>
        <Pressable onPress={onDelete} testID={`delete-${entry.id}`}><Text style={[styles.entryAction, styles.entryActionDanger]}>Delete</Text></Pressable>
      </View>
    </View>
  );
}

function PrayerEntryCard({
  entry,
  onDelete,
  onShare,
  sharing,
}: {
  entry: { id: string; text: string; prayer: string; created_at: string; verseReference?: string };
  onDelete: () => void;
  onShare: () => void;
  sharing?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = entry.prayer.length > 220 || (entry.prayer.match(/\n/g)?.length ?? 0) >= 5;
  return (
    <View style={[styles.entryCard, styles.entryCardPrayer]} testID={`prayer-saved-card-${entry.id}`}>
      <View style={styles.entryHeader}>
        <View style={styles.prayerTag}>
          <Ionicons name="leaf-outline" size={11} color={colors.accent} />
          <Text style={styles.prayerTagText}>Saved prayer</Text>
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
        <Pressable
          onPress={onShare}
          disabled={sharing}
          testID={`share-prayer-${entry.id}`}
          hitSlop={6}
          style={styles.prayerEntryShareBtn}
        >
          {sharing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <>
              <Ionicons name="share-outline" size={13} color={colors.accent} />
              <Text style={styles.entryAction}>Share</Text>
            </>
          )}
        </Pressable>
        <Pressable onPress={onDelete} testID={`delete-prayer-${entry.id}`}>
          <Text style={[styles.entryAction, styles.entryActionDanger]}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 140, gap: 14 },
  hero: { marginTop: 18, marginBottom: 18 },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.accent, letterSpacing: 2.4, textTransform: "uppercase", marginBottom: 16 },
  title: { fontFamily: fonts.sansSemibold, fontSize: 24, color: colors.text, letterSpacing: -0.4, lineHeight: 30 },
  streakBlock: { backgroundColor: colors.surface1, borderRadius: 22, padding: 22, gap: 18, marginBottom: 4 },
  streakTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  streakLabel: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.textTertiary, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 },
  streakHeadlineRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  streakNumber: { fontFamily: fonts.sansBold, fontSize: 38, color: colors.text, letterSpacing: -1 },
  streakUnit: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.textSecondary },
  streakHint: { fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  flameBubble: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  streakRow: { flexDirection: "row", justifyContent: "space-between" },
  streakCell: { alignItems: "center", gap: 6, flex: 1 },
  streakDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.1)" },
  streakDotActive: { backgroundColor: colors.accent },
  streakDotToday: { borderWidth: 1.5, borderColor: colors.accent, backgroundColor: "transparent" },
  streakDay: { fontFamily: fonts.sansMedium, fontSize: 10, color: colors.textTertiary },
  streakDayToday: { color: colors.accent, fontFamily: fonts.sansSemibold },
  promptBlock: { paddingHorizontal: 4, gap: 6, marginTop: 8 },
  promptLabel: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.accent, letterSpacing: 1.8, textTransform: "uppercase" },
  promptText: { fontFamily: fonts.serif, color: colors.text, fontSize: 18, lineHeight: 26 },
  inputWrap: { backgroundColor: colors.surface1, borderRadius: 22, padding: 18, marginTop: 4 },
  input: { color: colors.text, fontFamily: fonts.sans, fontSize: 16, minHeight: 130, textAlignVertical: "top", lineHeight: 24 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.textSecondary },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { fontFamily: fonts.sansSemibold, color: colors.textOnAccent, fontSize: 15, letterSpacing: 0.2 },
  cancelLink: { alignItems: "center", paddingVertical: 6 },
  cancelLinkText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.textSecondary },
  sectionLabel: { fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 2, color: colors.textTertiary, textTransform: "uppercase", marginTop: 24 },
  emptyCard: { backgroundColor: colors.surface1, borderRadius: 22, padding: 36, alignItems: "center", gap: 12 },
  emptyText: { fontFamily: fonts.serif, color: colors.textSecondary, fontSize: 15 },
  entryCard: { backgroundColor: colors.surface1, borderRadius: 18, padding: 18, gap: 10 },
  entryCardPrayer: { backgroundColor: "rgba(212,179,106,0.06)" },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entryChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  entryChipText: { fontFamily: fonts.sansSemibold, fontSize: 11 },
  prayerTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.accentSoft, flexDirection: "row", alignItems: "center", gap: 5 },
  prayerTagText: { fontFamily: fonts.sansSemibold, fontSize: 11, color: colors.accent },
  entryDate: { fontFamily: fonts.sans, fontSize: 12, color: colors.textTertiary },
  entryText: { fontFamily: fonts.serif, color: colors.text, fontSize: 15, lineHeight: 23 },
  entryRequest: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  entryPrayer: { fontFamily: fonts.serifItalic, fontStyle: "italic", color: colors.text, fontSize: 15, lineHeight: 23 },
  entryRef: { fontFamily: fonts.sansSemibold, fontSize: 12, color: colors.accent },
  entryActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 18, marginTop: 4 },
  entryAction: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.accent },
  entryActionAccent: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.accent },
  entryActionDanger: { color: "#F8B8B8" },
  prayerEntryShareBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  showMore: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.accent, marginTop: 2 },
});
