// Scripture. Editorial reading + reflection surface.
//
// Reading flow (top → bottom):
//   1. Today's Verse  (hero, date)
//   2. Verse card    (NLT text + open-in-Bible.com + share)
//   3. Devotional    (devotional card + share)
//   4. Reflection    (inline write input + emotion chips + save + "View all")
//
// Loading strategy — two-phase:
//   Phase 1: GET /api/daily-verse?include_devotional=false (no LLM, < 200ms)
//     → render the verse card immediately, render devotional skeleton.
//   Phase 2: GET /api/daily-verse (full, with LLM-backed devotional; cached
//     server-side per-day so all but the first user of a new day hit cache)
//     → swap skeleton for devotional text.
//
// The Bible Assistant (Q&A + on-demand devotional) now lives in its own tab.
// The reflections list/history lives at /reflections-history (also reachable
// from Settings → My Reflections).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, emotionColors, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import {
  detectTimezone,
  localDateInTz,
  loadCachedDevotional,
  saveCachedDevotional,
  cacheMatchesToday,
} from "@/src/lib/daily-devotional";
import { ShareImageModal, ShareKind } from "@/src/components/ShareImageModal";
import { getShareExcerpt } from "@/src/lib/share-excerpt";
import { formatVerseShareText } from "@/src/lib/verse-share";
import { showToast } from "@/src/components/Toast";
import { ConversionTrigger, track } from "@/src/lib/analytics";
import { requestUpgradePrompt } from "@/src/components/UpgradePromptHost";
import { StructuredDevotional } from "@/src/components/StructuredDevotional";
import type { StructuredDevotional as StructuredDevotionalType } from "@/src/lib/daily-devotional";

const BANNER_QUOTES = [
  "Stillness is a kind of prayer.",
  "Grace meets us where we are, not where we should be.",
  "The same God who made the stars knows your name.",
  "Every quiet morning is an invitation.",
  "You are loved more than you can carry.",
];

const EMOTIONS = ["Grateful", "Hopeful", "Anxious", "Peaceful", "Confused", "Joyful", "Tired", "Seeking"] as const;
type Emotion = (typeof EMOTIONS)[number];

const REFLECTION_PROMPTS = [
  "What is God saying to you through this verse?",
  "Where in your life does this verse meet you today?",
  "What comfort, conviction, or invitation do you hear here?",
  "How would your day change if you took this verse to heart?",
  "What word or phrase keeps drawing you back? Why?",
];

const todayLabel = () =>
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

type VerseMeta = { verse: string; reference: string; verse_id: string; bible_link: string };
type ShareSource = { kind: "verse" } | { kind: "devotional" };

export default function ScriptureScreen() {
  const router = useRouter();
  const [verse, setVerse] = useState<VerseMeta | null>(null);
  const [devotional, setDevotional] = useState<string>(""); // flat text — used for share + fallback
  const [structuredDevo, setStructuredDevo] = useState<StructuredDevotionalType | null>(null);
  const [verseLoading, setVerseLoading] = useState(true);
  const [devoLoading, setDevoLoading] = useState(true);
  const [bannerIdx, setBannerIdx] = useState(0);
  const bannerOpacity = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [, setNewDayPill] = useState(false);
  const newDayOpacity = useRef(new Animated.Value(0)).current;
  // Subtle skeleton shimmer.
  const shimmer = useRef(new Animated.Value(0)).current;

  // Reflection state -----------------------------------------------------
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionEmotion, setReflectionEmotion] = useState<Emotion | null>(null);
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const [reflectionSavedCount, setReflectionSavedCount] = useState(0);
  const todayReflectionPrompt = (() => {
    if (!verse) return REFLECTION_PROMPTS[0];
    let h = 0;
    for (const c of verse.verse_id) h = (h * 31 + c.charCodeAt(0)) | 0;
    return REFLECTION_PROMPTS[Math.abs(h) % REFLECTION_PROMPTS.length];
  })();

  // Share state ----------------------------------------------------------
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSource, setShareSource] = useState<ShareSource | null>(null);
  const [sharePreparing, setSharePreparing] = useState(false);
  const [sharePayload, setSharePayload] = useState<ShareKind | null>(null);

  // Load-error + pull-to-refresh state (Build 16 polish) -----------------
  // `loadError` drives the inline retry card that replaces the blank
  // fallback when a fresh install fails on a cold network. It's cleared
  // as soon as a subsequent load — from cache OR fresh fetch — succeeds.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Two-phase load orchestrator, extracted into a callable so pull-to-
  // refresh and inline retry can invoke it. `force=true` skips the cache
  // hit fast-path and always hits the network.
  const loadDailyVerse = useCallback(
    async (force = false) => {
      const tz = detectTimezone();
      const today = localDateInTz(tz);
      setLoadError(null);

      try {
        // Phase 0: client cache hit → render instantly. Force-refresh
        // (pull-to-refresh / retry) skips this so we always re-fetch.
        if (!force) {
          const cached = await loadCachedDevotional();
          if (cacheMatchesToday(cached, tz, today)) {
            const p = cached!.payload;
            setVerse({
              verse: p.verse,
              reference: p.reference,
              verse_id: p.verse_id,
              bible_link: p.bible_link,
            });
            setDevotional(p.devotional);
            setStructuredDevo(p.devotional_structured ?? null);
            setVerseLoading(false);
            setDevoLoading(false);
            Animated.timing(fade, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
              easing: Easing.out(Easing.cubic),
            }).start();
            return { fromCache: true, hadStaleCache: false };
          }
        }

        // Cache miss or force: hit the network. If phase 1 also fails
        // AND we have ANY prior cached payload, surface that as an offline
        // fallback so the screen never goes blank. This is the "display
        // cached verse if network is unavailable" branch from the ticket.
        try {
          const verseOnly = await api.dailyVerse(today, tz, false);
          setVerse({
            verse: verseOnly.verse,
            reference: verseOnly.reference,
            verse_id: verseOnly.verse_id,
            bible_link: verseOnly.bible_link,
          });
          setVerseLoading(false);
          Animated.timing(fade, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }).start();
        } catch (networkError) {
          // Network is unavailable — try to surface ANY stale cache
          // rather than a hard failure. Even yesterday's verse is more
          // useful than an error card while the user's on the subway.
          const stale = await loadCachedDevotional();
          if (stale) {
            const p = stale.payload;
            setVerse({
              verse: p.verse,
              reference: p.reference,
              verse_id: p.verse_id,
              bible_link: p.bible_link,
            });
            setDevotional(p.devotional);
            setStructuredDevo(p.devotional_structured ?? null);
            setVerseLoading(false);
            setDevoLoading(false);
            Animated.timing(fade, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
              easing: Easing.out(Easing.cubic),
            }).start();
            // Return early — background refresh will retry on next focus.
            return { fromCache: true, hadStaleCache: true };
          }
          throw networkError; // no cache → let outer catch surface error card
        }

        // Phase 2: devotional fetch (LLM). Skeleton stays visible until
        // this returns. On failure we keep the verse rendered — a
        // missing devotional is a soft failure, not a screen-blank event.
        try {
          const full = await api.dailyVerse(today, tz, true);
          setDevotional(full.devotional);
          setStructuredDevo(full.devotional_structured ?? null);
          setDevoLoading(false);
          await saveCachedDevotional({ date: today, tz, payload: full });
        } catch (devoError) {
          console.warn("devotional phase failed (verse still visible)", devoError);
          setDevotional("");
          setStructuredDevo(null);
          setDevoLoading(false);
        }
        return { fromCache: false, hadStaleCache: false };
      } catch (e) {
        console.warn("daily verse load failed", e);
        const msg =
          e instanceof Error
            ? e.message
            : "Check your connection and try again.";
        setLoadError(msg);
        setVerseLoading(false);
        setDevoLoading(false);
        return { fromCache: false, hadStaleCache: false };
      }
    },
    [fade],
  );

  // Two-phase load orchestrator.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tz = detectTimezone();
      const today = localDateInTz(tz);
      // Snapshot whether we had a hit BEFORE loading, so we can decide
      // whether to show the "new day" pill after a full load completes.
      const preCached = await loadCachedDevotional();
      const hadFreshCache = cacheMatchesToday(preCached, tz, today);
      if (cancelled) return;
      await loadDailyVerse(false);
      if (cancelled) return;
      if (!hadFreshCache && preCached) {
        // User crossed midnight — the transitional "new day" pill.
        setNewDayPill(true);
        Animated.sequence([
          Animated.timing(newDayOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.delay(3500),
          Animated.timing(newDayOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]).start(() => setNewDayPill(false));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDailyVerse, newDayOpacity]);

  /** Pull-to-refresh handler. Wraps loadDailyVerse(true) with the
   *  RefreshControl spinner state and guards against overlapping calls. */
  const onPullRefresh = useCallback(async () => {
    if (refreshing) return; // guard: no duplicate concurrent fetches
    setRefreshing(true);
    try {
      // Reset the devotional skeleton so the fresh copy fades in cleanly.
      setDevoLoading(true);
      await loadDailyVerse(true);
    } finally {
      setRefreshing(false);
    }
  }, [loadDailyVerse, refreshing]);

  /** Retry action shown in the inline error card when initial load failed
   *  AND no cache was available (fresh install + no network). */
  const onRetryLoad = useCallback(async () => {
    setVerseLoading(true);
    setDevoLoading(true);
    await loadDailyVerse(true);
  }, [loadDailyVerse]);

  /** Native OS Share sheet for the current verse. Uses formatVerseShareText
   *  to compose reference + verse text + optional attribution. Falls back
   *  silently on user-cancel; surfaces a toast only on hard failures. */
  const onNativeShareVerse = useCallback(async () => {
    if (!verse) return;
    try {
      const message = formatVerseShareText({
        reference: verse.reference,
        verse: verse.verse,
      });
      await Share.share({ message });
    } catch (e) {
      // Share.share() throws when the OS can't present the sheet (rare).
      // User-cancel does NOT throw on either platform, so no false toasts.
      console.warn("native share failed", e);
      showToast({
        variant: "error",
        title: "Couldn't open Share",
        message: "Please try again.",
        duration: 3000,
      });
    }
  }, [verse]);

  // Skeleton shimmer animation — only runs while something is loading.
  useEffect(() => {
    if (!verseLoading && !devoLoading) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer, verseLoading, devoLoading]);

  // Rotating banner copy.
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 350, useNativeDriver: true, easing: Easing.in(Easing.quad) }).start(() => {
        setBannerIdx((i) => (i + 1) % BANNER_QUOTES.length);
        Animated.timing(bannerOpacity, { toValue: 1, duration: 550, useNativeDriver: true, easing: Easing.out(Easing.quad) }).start();
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [bannerOpacity]);

  const openVerse = () => verse && Linking.openURL(verse.bible_link);

  const saveReflection = useCallback(async () => {
    if (!verse || !reflectionText.trim() || reflectionSaving) return;
    setReflectionSaving(true);
    try {
      const chars = reflectionText.trim().length;
      await api.createReflection(
        reflectionText.trim(),
        reflectionEmotion ?? undefined,
        todayReflectionPrompt,
        verse.verse_id,
      );
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
      track(ConversionTrigger.ReflectionSaved, { chars, has_emotion: !!reflectionEmotion, source: "scripture_inline" });
      try {
        if (nextCount >= 5) requestUpgradePrompt("five_reflections");
      } catch {}
    } catch (e) {
      console.warn("save reflection (inline) failed", e);
      // Friendly toast — never surface raw "API 401: ..." text.
      const isAuthExpired = !!(e && typeof e === "object" && (e as any).isAuthExpired);
      showToast({
        variant: isAuthExpired ? "info" : "error",
        title: isAuthExpired ? "Sign in to save" : "Couldn't save reflection",
        message: isAuthExpired
          ? "Sign in from Settings to save reflections to your journal."
          : "Check your connection and try again.",
        duration: 5000,
      });
    } finally {
      setReflectionSaving(false);
    }
  }, [verse, reflectionText, reflectionEmotion, reflectionSaving, reflectionSavedCount, todayReflectionPrompt]);

  // --- Share orchestration ---------------------------------------------
  const openShare = async (src: ShareSource) => {
    if (!verse || sharePreparing) return;
    if (src.kind === "devotional" && !devotional) return; // not ready yet
    setShareSource(src);
    setSharePreparing(true);
    try {
      if (src.kind === "verse") {
        setSharePayload({
          kind: "qa",
          excerpt: verse.verse,
          fullText: `${verse.verse}\n\n— ${verse.reference}`,
          reference: verse.reference,
          style: "Devotional",
          defaultTemplate: "centered",
        });
      } else {
        const excerpt = await getShareExcerpt(devotional, "Devotional");
        setSharePayload({
          kind: "qa",
          excerpt,
          fullText: devotional,
          reference: verse.reference,
          style: "Devotional",
          defaultTemplate: ["centered", "reflection", "insight"][Math.floor(Math.random() * 3)] as
            | "centered"
            | "reflection"
            | "insight",
        });
      }
      setShareOpen(true);
    } catch (e) {
      console.warn("share prep failed", e);
    } finally {
      setSharePreparing(false);
    }
  };

  const closeShare = () => {
    setShareOpen(false);
    setShareSource(null);
  };

  // Skeleton opacity: shimmer pulses between 0.55 and 1.0.
  const skeletonOpacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <ScreenBackground>
      <ScreenHeader />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={32}
        showsVerticalScrollIndicator={false}
        refreshControl={
          // Pull-to-refresh (Build 16). Force-reloads the verse + devotional
          // even when today's cache is warm. `refreshing` guards against
          // overlapping fetches inside onPullRefresh().
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
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Scripture</Text>
          <Text style={styles.title}>Today's verse</Text>
          <Text style={styles.dateLine}>{todayLabel()}</Text>
        </View>

        {/* Rotating quote */}
        <Animated.View style={[styles.banner, { opacity: bannerOpacity }]} testID="rotating-banner">
          <Text style={styles.bannerText}>{BANNER_QUOTES[bannerIdx]}</Text>
        </Animated.View>

        {/* Verse card — skeleton while loading, real card once Phase 1 returns.
            When a load hard-fails AND no cache exists, an inline retry card
            is shown INSTEAD of the skeleton so the screen never goes blank. */}
        {loadError && !verse ? (
          <View style={styles.errorCard} testID="verse-error-card">
            <Ionicons name="cloud-offline-outline" size={28} color={colors.accent} />
            <Text style={styles.errorTitle}>Couldn't load today's verse</Text>
            <Text style={styles.errorBody} numberOfLines={3}>
              {loadError.slice(0, 140) ||
                "Check your connection and try again."}
            </Text>
            <Pressable
              onPress={onRetryLoad}
              style={({ pressed }) => [
                styles.retryBtn,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              testID="verse-retry-button"
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : verseLoading || !verse ? (
          <Animated.View style={[styles.verseCard, styles.verseSkeleton, { opacity: skeletonOpacity }]} testID="verse-skeleton">
            <View style={[styles.skeletonBar, { width: "40%", height: 11 }]} />
            <View style={{ gap: 10 }}>
              <View style={[styles.skeletonBar, { width: "100%", height: 18 }]} />
              <View style={[styles.skeletonBar, { width: "90%", height: 18 }]} />
              <View style={[styles.skeletonBar, { width: "65%", height: 18 }]} />
            </View>
          </Animated.View>
        ) : (
          <Animated.View style={[styles.verseCard, { opacity: fade }]} testID="verse-card">
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>NLT · {verse.reference}</Text>
              <View style={styles.metaActions}>
                <Pressable onPress={openVerse} testID="verse-bible-link" hitSlop={8} style={styles.metaIconBtn}>
                  <Ionicons name="open-outline" size={16} color={colors.accent} />
                </Pressable>
                <Pressable
                  onPress={onNativeShareVerse}
                  testID="share-scripture-native-button"
                  hitSlop={8}
                  style={styles.metaIconBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Share verse"
                >
                  <Ionicons name="paper-plane-outline" size={16} color={colors.accent} />
                </Pressable>
                <Pressable
                  onPress={() => openShare({ kind: "verse" })}
                  testID="share-scripture-button"
                  hitSlop={8}
                  style={styles.metaIconBtn}
                >
                  {sharePreparing && shareSource?.kind === "verse" ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="share-outline" size={16} color={colors.accent} />
                  )}
                </Pressable>
              </View>
            </View>
            <Text style={styles.verseText}>"{verse.verse}"</Text>
          </Animated.View>
        )}

        {/* Devotional — skeleton until Phase 2 resolves. */}
        <View>
          <View style={styles.devoHeader}>
            <Text style={styles.sectionLabel}>Devotional</Text>
            {!devoLoading && !!devotional && verse && (
              <Pressable
                onPress={() => openShare({ kind: "devotional" })}
                hitSlop={8}
                style={styles.devoShareBtn}
                testID="share-devotional-button"
                accessibilityRole="button"
                accessibilityLabel="Share devotional"
              >
                {sharePreparing && shareSource?.kind === "devotional" ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons name="share-outline" size={14} color={colors.accent} />
                )}
              </Pressable>
            )}
          </View>
          {devoLoading || !devotional ? (
            <Animated.View style={[styles.devotionalCard, { opacity: skeletonOpacity, gap: 10 }]} testID="devotional-skeleton">
              <View style={[styles.skeletonBar, { width: "98%", height: 13 }]} />
              <View style={[styles.skeletonBar, { width: "94%", height: 13 }]} />
              <View style={[styles.skeletonBar, { width: "88%", height: 13 }]} />
              <View style={[styles.skeletonBar, { width: "70%", height: 13 }]} />
              <View style={{ height: 6 }} />
              <View style={[styles.skeletonBar, { width: "92%", height: 13 }]} />
              <View style={[styles.skeletonBar, { width: "60%", height: 13 }]} />
            </Animated.View>
          ) : structuredDevo ? (
            <StructuredDevotional
              devo={structuredDevo}
              reference={verse?.reference ?? ""}
              testID="devotional-card"
            />
          ) : (
            // Legacy / fallback path — older cached entries or LLM JSON
            // parse failures render as a single flowing paragraph card.
            <View style={styles.devotionalCard} testID="devotional-card">
              <Text style={styles.devotionalText}>{devotional}</Text>
            </View>
          )}
        </View>

        {/* Reflection — inline, scoped to today's verse. Only shown once we have a verse. */}
        {verse && (
          <Animated.View style={{ opacity: fade }} testID="reflection-section">
            <Text style={styles.sectionLabel}>Reflection</Text>
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
                    <Text style={[styles.emotionChipText, active && { color: c.text }]}>{em}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={saveReflection}
              disabled={!reflectionText.trim() || reflectionSaving}
              style={[styles.saveBtn, (!reflectionText.trim() || reflectionSaving) && styles.saveBtnDisabled]}
              testID="scripture-save-reflection-button"
            >
              {reflectionSaving ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <Text style={styles.saveBtnText}>Save reflection</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => router.push("/reflections-history" as any)}
              style={styles.viewAllLink}
              testID="view-all-reflections-link"
              accessibilityRole="button"
              accessibilityLabel="View My Journal"
            >
              <Text style={styles.viewAllText}>View My Journal</Text>
              <Ionicons name="arrow-forward" size={13} color={colors.accent} />
            </Pressable>
          </Animated.View>
        )}
      </KeyboardAwareScrollView>

      {sharePayload && (
        <ShareImageModal
          visible={shareOpen}
          onClose={closeShare}
          payload={sharePayload}
        />
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 140, gap: 16 },
  hero: { marginTop: 18, marginBottom: 6 },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.accent, letterSpacing: 2.4, textTransform: "uppercase", marginBottom: 16 },
  title: { fontFamily: fonts.sansSemibold, fontSize: 24, color: colors.text, letterSpacing: -0.4, lineHeight: 30 },
  dateLine: { fontFamily: fonts.sans, fontSize: 14, color: colors.textSecondary, marginTop: 10 },
  banner: { paddingVertical: 10, alignItems: "center" },
  bannerText: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 13, textAlign: "center", letterSpacing: 0.2 },
  verseCard: {
    backgroundColor: colors.surface1,
    borderRadius: 26,
    padding: 28,
    gap: 18,
  },
  verseSkeleton: { minHeight: 140, justifyContent: "center" },
  // Inline error card shown when a fresh install fails on cold network
  // and no cached verse exists. Prefers to be visually calm — this is the
  // user's first impression when things break.
  errorCard: {
    backgroundColor: "rgba(200, 169, 107, 0.06)",
    borderColor: "rgba(200, 169, 107, 0.28)",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "600",
    marginTop: 4,
  },
  errorBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 280,
  },
  retryBtn: {
    marginTop: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  retryBtnText: { color: "#0a0e1a", fontWeight: "600", fontSize: 15 },
  skeletonBar: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 6,
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.accent, letterSpacing: 1.8, textTransform: "uppercase" },
  metaActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  verseText: { fontFamily: fonts.serif, fontSize: 24, color: colors.text, lineHeight: 36, letterSpacing: 0.1 },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.textTertiary,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  devoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  devoShareBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(200,169,107,0.10)",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.22)",
    marginBottom: 10,
  },
  devotionalCard: {
    backgroundColor: colors.surface1,
    borderRadius: 20,
    padding: 24,
  },
  devotionalText: { fontFamily: fonts.serif, color: colors.text, fontSize: 16, lineHeight: 26 },

  // ---- Reflection (inline) ----
  reflectionPrompt: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  reflectionInputWrap: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    padding: 4,
    marginBottom: 12,
  },
  reflectionInput: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 15,
    minHeight: 110,
    textAlignVertical: "top",
    padding: 14,
    lineHeight: 22,
  },
  emotionChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  emotionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  emotionChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: {
    fontFamily: fonts.sansSemibold,
    color: colors.textOnAccent,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  viewAllLink: {
    alignSelf: "center",
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  viewAllText: { fontFamily: fonts.sansMedium, color: colors.accent, fontSize: 14 },
});
