// Scripture — Journey Through Scripture (canonical-web-v1).
//
// Renders the reading assigned to the caller's current day from the immutable
// canonical-web-v1 plan bundled on the backend. No AI devotional generation.
// No client-side passage caching. No plan switching.
//
// Layout (top → bottom):
//   1. Hero          — "Journey Through Scripture" + Day X of 995 pill.
//   2. Section/book  — meta chips (section, book name, editorial note).
//   3. Passage ref   — the reading range as an accent line.
//   4. Key Verse     — prominent card at the top of the reading.
//   5. Passage       — full text grouped by chapter, expandable.
//   6. Overview      — passage summary (NOT devotional).
//   7. Reflection    — inline reflection input + emotion chips + journal nav.
//
// Auth handling:
//   • Signed-in users: request carries the Bearer token; the endpoint returns
//     the user's saved day. Progression is server-side.
//   • Guests / anonymous: request goes without a token; endpoint returns Day 1
//     with `progress: null`. UI shows Day 1 with no "resume" language.
//   • Expired token: the api layer transparently refreshes; if refresh fails,
//     an `AuthExpiredError` is thrown. We show a small "sign in to resume"
//     banner but still render Day 1 so the user can read something.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, emotionColors, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import type { DailyVerseResponse } from "@/src/lib/api";
import { recordActiveDay } from "@/src/lib/streak-ledger";
import { detectTimezone, localDateInTz } from "@/src/lib/daily-devotional";
import { ShareImageModal, ShareKind } from "@/src/components/ShareImageModal";
import { getShareExcerpt } from "@/src/lib/share-excerpt";
import { formatVerseShareText } from "@/src/lib/verse-share";
import { showToast } from "@/src/components/Toast";
import { ConversionTrigger, track } from "@/src/lib/analytics";
import { forceUpgradePrompt } from "@/src/components/UpgradePromptHost";
import { useAuthState } from "@/src/hooks/use-auth-state";
import { EmptyState } from "@/src/components/EmptyState";
import { DAILY_VERSE_ERROR } from "@/src/lib/empty-state-copy";

// -----------------------------------------------------------------------------
// Local helpers
// -----------------------------------------------------------------------------
type Emotion = "peaceful" | "joyful" | "grateful" | "hopeful" | "reflective";
const EMOTIONS: Emotion[] = ["peaceful", "joyful", "grateful", "hopeful", "reflective"];

const REFLECTION_PROMPTS = [
  "What in this reading stays with you?",
  "Where does this reading meet you today?",
  "What is God saying to you through this passage?",
  "Which line will you carry into your afternoon?",
];

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type ShareSource = { kind: "verse" } | { kind: "overview" };

// Group a flat list of `{chapter, verse, text}` into per-chapter buckets so the
// reader gets natural rhythm and comfortable spacing rather than a wall of text.
function groupByChapter(passage: DailyVerseResponse["passage"]) {
  const groups: { chapter: number; verses: DailyVerseResponse["passage"] }[] = [];
  for (const v of passage) {
    const last = groups[groups.length - 1];
    if (!last || last.chapter !== v.chapter) {
      groups.push({ chapter: v.chapter, verses: [v] });
    } else {
      last.verses.push(v);
    }
  }
  return groups;
}

// -----------------------------------------------------------------------------
// Screen
// -----------------------------------------------------------------------------
export default function ScriptureScreen() {
  const router = useRouter();
  const auth = useAuthState();

  const openJournal = () => {
    if (auth.ready && !auth.user) {
      forceUpgradePrompt("journal_entry_guest");
      return;
    }
    router.push("/reflections-history" as any);
  };

  // Reading state --------------------------------------------------------
  const [data, setData] = useState<DailyVerseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [passageExpanded, setPassageExpanded] = useState<boolean>(false);
  const [overviewExpanded, setOverviewExpanded] = useState<boolean>(false);
  const [readingComplete, setReadingComplete] = useState<boolean>(false);
  const fade = useRef(new Animated.Value(0)).current;
  const completeFade = useRef(new Animated.Value(0)).current;

  // Reflection state -----------------------------------------------------
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionEmotion, setReflectionEmotion] = useState<Emotion | null>(null);
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const [reflectionSavedCount, setReflectionSavedCount] = useState(0);
  const todayReflectionPrompt = useMemo(() => {
    if (!data) return REFLECTION_PROMPTS[0];
    let h = 0;
    for (const c of data.verse_id) h = (h * 31 + c.charCodeAt(0)) | 0;
    return REFLECTION_PROMPTS[Math.abs(h) % REFLECTION_PROMPTS.length];
  }, [data]);

  // Share state ----------------------------------------------------------
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSource, setShareSource] = useState<ShareSource | null>(null);
  const [sharePreparing, setSharePreparing] = useState(false);
  const [sharePayload, setSharePayload] = useState<ShareKind | null>(null);

  // Completion transition ------------------------------------------------
  // Declared here (early) so callbacks below can safely reference it.
  const markReadingComplete = useCallback(() => {
    if (readingComplete) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReadingComplete(true);
    Animated.timing(completeFade, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [readingComplete, completeFade]);

  // Track the local date we last rendered so a midnight-crossing rollover
  // triggers a fresh request on next focus.
  const lastLoadedDateRef = useRef<string | null>(null);

  // Fetch orchestrator ---------------------------------------------------
  const loadDaily = useCallback(async () => {
    const tz = detectTimezone();
    const today = localDateInTz(tz);
    lastLoadedDateRef.current = today;
    setLoadError(null);
    try {
      const payload = await api.dailyVerse(today, tz, true);
      setData(payload);
      setAuthExpired(false);
      setLoading(false);
      Animated.timing(fade, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start();
      return { ok: true as const };
    } catch (e) {
      const isAuthErr = !!(e && typeof e === "object" && (e as any).isAuthExpired);
      if (isAuthErr) {
        // Refresh failed. Show the banner + fall back to a guest-flavoured
        // Day-1 fetch so the screen isn't blank. NOTE this deliberately does
        // NOT read "your progress was reset" — we treat this as a session
        // problem, not a plan reset.
        setAuthExpired(true);
        try {
          const anon = await api.dailyVerse(today, tz, true);
          setData(anon);
        } catch (fallbackErr) {
          setLoadError(
            fallbackErr instanceof Error ? fallbackErr.message : "Please check your connection.",
          );
        }
      } else {
        console.warn("scripture: daily load failed", e);
        setLoadError(
          e instanceof Error ? e.message : "Please check your connection.",
        );
      }
      setLoading(false);
      return { ok: false as const };
    }
  }, [fade]);

  // First load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadDaily();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDaily]);

  // Day-rollover watcher: on focus/foreground, if the device's local date
  // changed since we last rendered, refetch. This is how a user who leaves
  // the app open overnight advances to the next day.
  const refreshIfDayChanged = useCallback(async () => {
    const tz = detectTimezone();
    const today = localDateInTz(tz);
    if (lastLoadedDateRef.current && lastLoadedDateRef.current !== today) {
      await loadDaily();
    }
  }, [loadDaily]);

  useFocusEffect(
    useCallback(() => {
      refreshIfDayChanged();
    }, [refreshIfDayChanged]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshIfDayChanged();
    });
    return () => sub.remove();
  }, [refreshIfDayChanged]);

  const onPullRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadDaily();
    } finally {
      setRefreshing(false);
    }
  }, [loadDaily, refreshing]);

  const onRetryLoad = useCallback(async () => {
    setLoading(true);
    await loadDaily();
  }, [loadDaily]);

  // Share ---------------------------------------------------------------
  const onNativeShare = useCallback(async () => {
    if (!data) return;
    try {
      const message = formatVerseShareText({
        verse: data.key_verse.text,
        reference: data.key_verse.reference,
        bibleLink: data.bible_link,
      });
      await Share.share({ message });
    } catch (e) {
      console.warn("native share failed", e);
      showToast({ variant: "error", title: "Couldn't open Share", duration: 3000 });
    }
  }, [data]);

  const openShare = async (src: ShareSource) => {
    if (!data || sharePreparing) return;
    setShareSource(src);
    setSharePreparing(true);
    try {
      if (src.kind === "verse") {
        setSharePayload({
          kind: "qa",
          excerpt: data.key_verse.text,
          fullText: `${data.key_verse.text}\n\n— ${data.key_verse.reference}`,
          reference: data.key_verse.reference,
          question: null,
        });
      } else {
        const excerpt = await getShareExcerpt(data.summary, "Devotional");
        setSharePayload({
          kind: "devotional",
          excerpt,
          fullText: data.summary,
          reference: data.reference,
        });
      }
      setShareOpen(true);
    } catch (e) {
      console.warn("prepare share failed", e);
      showToast({ variant: "error", title: "Couldn't prepare share", duration: 3000 });
    } finally {
      setSharePreparing(false);
    }
  };

  const closeShare = () => {
    setShareOpen(false);
    setShareSource(null);
    setSharePayload(null);
  };

  // Reflection save -----------------------------------------------------
  const saveReflection = useCallback(async () => {
    if (!data || !reflectionText.trim() || reflectionSaving) return;
    setReflectionSaving(true);
    try {
      const chars = reflectionText.trim().length;
      await api.createReflection(
        reflectionText.trim(),
        reflectionEmotion ?? undefined,
        todayReflectionPrompt,
        data.verse_id,
      );
      recordActiveDay().catch((e) => console.warn("streak ledger record failed", e));
      setReflectionText("");
      setReflectionEmotion(null);
      const nextCount = reflectionSavedCount + 1;
      setReflectionSavedCount(nextCount);
      showToast({
        variant: "success",
        title: "Reflection saved",
        message: "View it anytime in My Journal.",
        duration: 3000,
      });
      track(ConversionTrigger.ReflectionSaved, {
        chars,
        has_emotion: !!reflectionEmotion,
        source: "scripture_canonical_reading",
      });
      markReadingComplete();
    } catch (e) {
      const isAuthErr = !!(e && typeof e === "object" && (e as any).isAuthExpired);
      showToast({
        variant: isAuthErr ? "info" : "error",
        title: isAuthErr ? "Sign in to save" : "Couldn't save reflection",
        message: isAuthErr
          ? "Sign in from Settings to save reflections to your journal."
          : "Check your connection and try again.",
        duration: 5000,
      });
    } finally {
      setReflectionSaving(false);
    }
  }, [data, reflectionText, reflectionEmotion, reflectionSaving, reflectionSavedCount, todayReflectionPrompt, markReadingComplete]);

  // Reading time — silent-read estimate at 225 wpm, floor 1 minute.
  const readingTimeMinutes = useMemo(() => {
    if (!data) return 1;
    const words = data.passage.reduce(
      (sum, v) => sum + v.text.split(/\s+/).filter(Boolean).length,
      0,
    );
    return Math.max(1, Math.round(words / 225));
  }, [data]);

  // Passage-overview truncation. We only truncate if the summary exceeds
  // this soft ceiling — most Haiku summaries fall in 45–55 words so this
  // shows a "Read more" only for the longer ones.
  const OVERVIEW_TRUNCATE_CHARS = 220;
  const overviewIsLong = !!data && data.summary.length > OVERVIEW_TRUNCATE_CHARS;
  const overviewText = useMemo(() => {
    if (!data) return "";
    if (!overviewIsLong || overviewExpanded) return data.summary;
    // truncate at last word boundary before the ceiling
    const slice = data.summary.slice(0, OVERVIEW_TRUNCATE_CHARS);
    const cut = slice.lastIndexOf(" ");
    return `${slice.slice(0, cut > 60 ? cut : slice.length).trim()}…`;
  }, [data, overviewIsLong, overviewExpanded]);

  const continueToPrayer = useCallback(() => {
    router.push("/(tabs)/prayer" as any);
  }, [router]);

  const togglePassage = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPassageExpanded((v) => !v);
    // Reading the full passage counts as completing today's reading.
    markReadingComplete();
  }, [markReadingComplete]);

  const toggleOverview = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOverviewExpanded((v) => !v);
  }, []);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  const isGuestPayload = !!data && data.progress === null;
  const passageGroups = data ? groupByChapter(data.passage) : [];

  return (
    <ScreenBackground>
      <ScreenHeader title="Scripture" />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={32}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.bg}
            testID="scripture-pull-to-refresh"
          />
        }
      >
        {/* --------------- HERO --------------- */}
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Journey Through Scripture</Text>
          {loading ? (
            <>
              <View style={[styles.skeletonBar, { width: "35%", height: 14, marginTop: 10 }]} />
              <View style={[styles.skeletonBar, { width: "80%", height: 26, marginTop: 12 }]} />
            </>
          ) : data ? (
            <>
              <Text style={styles.dayLine} testID="scripture-day-headline">
                Today&rsquo;s Reading{" "}
                <Text style={styles.dayLineMuted}>· Day {data.day} of {data.total_days}</Text>
              </Text>
              <Text style={styles.passageRefHero} testID="scripture-passage-reference">
                {data.reference}
              </Text>
              <View style={styles.metaRow} testID="scripture-meta-row">
                <View style={styles.chipRow} testID="scripture-meta-chips">
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{data.section}</Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{data.book_name}</Text>
                  </View>
                </View>
                <View style={styles.readingTimePill} testID="scripture-reading-time">
                  <Ionicons name="time-outline" size={12} color={colors.textTertiary} />
                  <Text style={styles.readingTimeText}>
                    {readingTimeMinutes} min read
                  </Text>
                </View>
              </View>
              {isGuestPayload && auth.ready && !auth.user && (
                <Text style={styles.guestHint} testID="scripture-guest-hint">
                  Sign in to continue your Scripture journey across devices.
                </Text>
              )}
              {isGuestPayload && auth.ready && !!auth.user && authExpired && (
                <Text style={styles.authHint} testID="scripture-auth-hint">
                  Your session paused. Sign in again from Settings to resume your saved day.
                </Text>
              )}
            </>
          ) : null}
        </View>

        {/* --------------- ERROR STATE --------------- */}
        {loadError && !data ? (
          <EmptyState
            variant="error"
            icon="cloud-offline-outline"
            title={DAILY_VERSE_ERROR.title}
            body={DAILY_VERSE_ERROR.body}
            action={{
              label: DAILY_VERSE_ERROR.cta,
              onPress: onRetryLoad,
              loading,
              testID: "scripture-retry-button",
            }}
            testID="scripture-error-card"
          />
        ) : null}

        {/* --------------- KEY VERSE (label + ref above quote; tightened) --------------- */}
        {data && (
          <Animated.View style={{ opacity: fade }}>
            <View style={styles.keyVerseCard} testID="scripture-key-verse">
              <Text style={styles.keyVerseLabel}>Key Verse</Text>
              <Text style={styles.keyVerseRef}>{data.key_verse.reference}</Text>
              <Text style={styles.keyVerseText}>
                &ldquo;{data.key_verse.text}&rdquo;
              </Text>
              <View style={styles.keyVerseActions}>
                <Pressable
                  onPress={onNativeShare}
                  hitSlop={8}
                  style={styles.iconBtn}
                  testID="scripture-share-native"
                  accessibilityRole="button"
                  accessibilityLabel="Share key verse"
                >
                  <Ionicons name="paper-plane-outline" size={16} color={colors.textTertiary} />
                </Pressable>
                <Pressable
                  onPress={() => openShare({ kind: "verse" })}
                  hitSlop={8}
                  style={styles.iconBtn}
                  testID="scripture-share-verse"
                >
                  {sharePreparing && shareSource?.kind === "verse" ? (
                    <ActivityIndicator size="small" color={colors.textTertiary} />
                  ) : (
                    <Ionicons name="share-outline" size={16} color={colors.textTertiary} />
                  )}
                </Pressable>
              </View>
            </View>
          </Animated.View>
        )}

        {/* --------------- PASSAGE OVERVIEW (tighter, expandable) --------------- */}
        {data && (
          <Animated.View style={{ opacity: fade }}>
            <Text style={styles.sectionLabel}>Passage Overview</Text>
            <View style={styles.overviewCard} testID="scripture-passage-overview">
              <Text style={styles.overviewText}>{overviewText}</Text>
              {overviewIsLong && (
                <Pressable
                  onPress={toggleOverview}
                  hitSlop={8}
                  style={styles.overviewMoreBtn}
                  testID="scripture-overview-toggle"
                  accessibilityRole="button"
                  accessibilityLabel={overviewExpanded ? "Show less" : "Read more"}
                >
                  <Text style={styles.overviewMoreText}>
                    {overviewExpanded ? "Show less" : "Read more"}
                  </Text>
                </Pressable>
              )}
            </View>
          </Animated.View>
        )}

        {/* --------------- FULL PASSAGE (expandable, chapter-grouped) --------------- */}
        {data && (
          <Animated.View style={{ opacity: fade }} testID="scripture-full-passage">
            <Pressable
              onPress={togglePassage}
              hitSlop={8}
              style={styles.passageToggle}
              accessibilityRole="button"
              accessibilityLabel={passageExpanded ? "Hide full passage" : "Read the full passage"}
              testID="scripture-passage-toggle"
            >
              <Text style={styles.passageToggleText}>
                {passageExpanded ? "Hide the full passage" : "Read the full passage"}
              </Text>
              <Ionicons
                name={passageExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textTertiary}
              />
            </Pressable>
            {passageExpanded && (
              <View style={styles.passageBody}>
                {passageGroups.map((g) => (
                  <View key={g.chapter} style={styles.chapterBlock}>
                    <Text style={styles.chapterHeading}>
                      {data.book_name} {g.chapter}
                    </Text>
                    <View style={{ gap: 8 }}>
                      {g.verses.map((v) => (
                        <Text key={`${v.chapter}:${v.verse}`} style={styles.verseLine}>
                          <Text style={styles.verseNum}>{v.verse} </Text>
                          {v.text}
                        </Text>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>
        )}

        {/* --------------- PAUSE & REFLECT --------------- */}
        {data && (
          <Animated.View style={{ opacity: fade }} testID="scripture-reflection-section">
            <Text style={styles.sectionLabel}>Pause &amp; Reflect</Text>
            <Text style={styles.reflectionSubtitle}>What stood out to you today?</Text>
            <Text style={styles.reflectionPrompt}>{todayReflectionPrompt}</Text>

            <View style={styles.reflectionInputWrap}>
              <TextInput
                value={reflectionText}
                onChangeText={setReflectionText}
                placeholder="Write what's stirring…"
                placeholderTextColor={colors.textTertiary}
                multiline
                style={styles.reflectionInput}
                testID="scripture-reflection-input"
              />
            </View>

            <View style={styles.emotionChipsWrap} testID="scripture-emotion-chips">
              {EMOTIONS.map((em) => {
                const c = emotionColors[em];
                const active = reflectionEmotion === em;
                return (
                  <Pressable
                    key={em}
                    onPress={() => setReflectionEmotion(active ? null : em)}
                    style={[
                      styles.emotionChip,
                      { backgroundColor: active ? c.bg : colors.surface1 },
                      active && { borderColor: c.border, borderWidth: 1 },
                    ]}
                    testID={`scripture-emotion-chip-${em}`}
                  >
                    <Text style={[styles.emotionChipText, active && { color: c.text }]}>
                      {em}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={saveReflection}
              disabled={!reflectionText.trim() || reflectionSaving}
              style={[
                styles.saveBtn,
                (!reflectionText.trim() || reflectionSaving) && styles.saveBtnDisabled,
              ]}
              testID="scripture-save-reflection-button"
            >
              {reflectionSaving ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <Text style={styles.saveBtnText}>Save reflection</Text>
              )}
            </Pressable>

            <Pressable
              onPress={openJournal}
              style={styles.viewAllLink}
              testID="scripture-view-journal-link"
              accessibilityRole="button"
              accessibilityLabel="View My Journal"
            >
              <Text style={styles.viewAllText}>View My Journal</Text>
              <Ionicons name="arrow-forward" size={13} color={colors.accent} />
            </Pressable>
          </Animated.View>
        )}

        {/* --------------- COMPLETION TRANSITION --------------- */}
        {data && readingComplete && (
          <Animated.View
            style={[styles.completionCard, { opacity: completeFade }]}
            testID="scripture-completion-card"
          >
            <View style={styles.completionCheck}>
              <Ionicons name="checkmark" size={18} color={colors.textOnAccent} />
            </View>
            <Text style={styles.completionTitle}>Today&rsquo;s Reading Complete</Text>
            <Text style={styles.completionSubtitle}>
              Carry this word into prayer.
            </Text>
            <Pressable
              onPress={continueToPrayer}
              style={styles.completionCta}
              testID="scripture-continue-to-prayer"
              accessibilityRole="button"
              accessibilityLabel="Continue to Prayer"
            >
              <Text style={styles.completionCtaText}>Continue to Prayer</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent} />
            </Pressable>
          </Animated.View>
        )}
      </KeyboardAwareScrollView>

      {sharePayload && (
        <ShareImageModal visible={shareOpen} onClose={closeShare} payload={sharePayload} />
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 140, gap: 20 },
  hero: { marginTop: 18, marginBottom: 4, gap: 6 },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  // Muted secondary line: "Today's Reading · Day 1 of 995"
  dayLine: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
    letterSpacing: 0.3,
    marginTop: 10,
  },
  dayLineMuted: {
    color: colors.textTertiary,
    fontFamily: fonts.sans,
  },
  // Passage reference is now the visual hero
  passageRefHero: {
    fontFamily: fonts.sansSemibold,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.4,
    lineHeight: 34,
    marginTop: 4,
  },
  metaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  chipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  readingTimePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  readingTimeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  guestHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 10,
    letterSpacing: 0.2,
    lineHeight: 18,
  },
  authHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.accent,
    marginTop: 10,
    letterSpacing: 0.2,
    lineHeight: 18,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.textTertiary,
    textTransform: "uppercase",
    marginBottom: 10,
  },

  // Key Verse — tighter card, label + ref above quote
  keyVerseCard: {
    backgroundColor: colors.surface1,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 18,
    gap: 6,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  keyVerseLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  keyVerseRef: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.2,
    marginTop: 2,
    marginBottom: 6,
  },
  keyVerseText: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.text,
    lineHeight: 30,
    letterSpacing: 0.1,
  },
  keyVerseActions: {
    flexDirection: "row",
    gap: 2,
    marginTop: 4,
    marginLeft: -8,
  },
  iconBtn: { padding: 8, borderRadius: 20 },

  // Passage overview (tighter padding, expandable)
  overviewCard: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  overviewText: {
    fontFamily: fonts.serif,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  overviewMoreBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
  },
  overviewMoreText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
  },

  // Full passage
  passageToggle: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
  },
  passageToggleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  passageBody: {
    gap: 22,
    paddingTop: 4,
  },
  chapterBlock: {
    gap: 12,
    paddingBottom: 4,
  },
  chapterHeading: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.textTertiary,
  },
  verseLine: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 27,
    color: colors.text,
  },
  verseNum: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.accent,
  },

  // Pause & Reflect
  reflectionSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textTertiary,
    letterSpacing: 0.2,
    marginBottom: 12,
    marginTop: -4,
  },
  reflectionPrompt: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.text,
    lineHeight: 26,
    marginBottom: 14,
  },
  reflectionInputWrap: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    padding: 4,
    marginBottom: 14,
  },
  reflectionInput: {
    fontFamily: fonts.serif,
    fontSize: 15,
    color: colors.text,
    minHeight: 90,
    padding: 14,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  emotionChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  emotionChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
  },
  emotionChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  saveBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.textOnAccent,
    letterSpacing: 0.5,
  },
  viewAllLink: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  viewAllText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.accent,
    letterSpacing: 0.5,
  },

  // Completion transition
  completionCard: {
    backgroundColor: colors.surface1,
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.18)",
  },
  completionCheck: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  completionTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  completionSubtitle: {
    fontFamily: fonts.serif,
    fontSize: 13,
    color: colors.textSecondary,
    letterSpacing: 0.1,
    lineHeight: 20,
    marginBottom: 6,
  },
  completionCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  completionCtaText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.accent,
    letterSpacing: 0.5,
  },

  // Loading skeleton
  skeletonBar: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 6,
  },
});
