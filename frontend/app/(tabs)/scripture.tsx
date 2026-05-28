// Scripture Unplugged. Daily NLT verse with reactions, devotional, and theological Q&A.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
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
import { colors, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";

const BANNER_QUOTES = [
  "Stillness is a kind of prayer.",
  "Grace meets us where we are, not where we should be.",
  "The same God who made the stars knows your name.",
  "Every quiet morning is an invitation.",
  "You are loved more than you can carry.",
];

type ReactionKey = "pray" | "love" | "fire" | "insight";
type ReactionMeta = { key: ReactionKey; icon: keyof typeof Ionicons.glyphMap; label: string };

const REACTIONS: ReactionMeta[] = [
  { key: "pray", icon: "leaf-outline", label: "Pray" },
  { key: "love", icon: "heart-outline", label: "Love" },
  { key: "fire", icon: "flame-outline", label: "Power" },
  { key: "insight", icon: "bulb-outline", label: "Insight" },
];

type Style = "Devotional" | "Theologian";
const STYLES: Style[] = ["Devotional", "Theologian"];

export default function ScriptureScreen() {
  const router = useRouter();
  const [verse, setVerse] = useState<{ verse: string; reference: string; verse_id: string; bible_link: string; devotional: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({ pray: 0, love: 0, fire: 0, insight: 0 });
  const [bannerIdx, setBannerIdx] = useState(0);
  const bannerOpacity = useRef(new Animated.Value(1)).current;

  const [question, setQuestion] = useState("");
  const [lastAskedQuestion, setLastAskedQuestion] = useState<string>("");
  const [style, setStyle] = useState<Style>("Devotional");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaResponses, setQaResponses] = useState<Record<Style, string>>({ Devotional: "", Theologian: "" });

  useEffect(() => {
    (async () => {
      try {
        const v = await api.dailyVerse();
        setVerse(v);
        const c = await api.getReactionCounts(v.verse_id);
        setCounts(c.counts);
      } catch (e) {
        console.warn("daily verse load failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Rotating banner
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 400, useNativeDriver: true, easing: Easing.in(Easing.quad) }).start(() => {
        setBannerIdx((i) => (i + 1) % BANNER_QUOTES.length);
        Animated.timing(bannerOpacity, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.quad) }).start();
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [bannerOpacity]);

  const handleReact = async (key: ReactionKey) => {
    if (!verse) return;
    setCounts((c) => ({ ...c, [key]: (c[key] ?? 0) + 1 }));
    try {
      const res = await api.reactToVerse(verse.verse_id, key);
      setCounts((c) => ({ ...c, [key]: res.count }));
    } catch (e) {
      console.warn("react failed", e);
    }
  };

  const runQA = useCallback(
    async (q: string, s: Style) => {
      if (!verse || !q.trim()) return;
      setQaLoading(true);
      try {
        const r = await api.theologicalQuestion(q.trim(), `"${verse.verse}" (${verse.reference})`, s);
        setQaResponses((prev) => ({ ...prev, [s]: r.response }));
      } catch (e) {
        console.warn("theological question failed", e);
      } finally {
        setQaLoading(false);
      }
    },
    [verse]
  );

  const submitQuestion = async () => {
    if (!question.trim() || qaLoading) return;
    const q = question.trim();
    setLastAskedQuestion(q);
    setQaResponses({ Devotional: "", Theologian: "" });
    await runQA(q, style);
  };

  const handleStyleChange = async (s: Style) => {
    if (s === style) return;
    setStyle(s);
    // If we already have a question asked, regenerate the response in the new style
    // (or reuse a cached one).
    if (!lastAskedQuestion) return;
    if (qaResponses[s]) return; // already have it cached
    await runQA(lastAskedQuestion, s);
  };

  const goReflect = () => {
    if (!verse) return;
    router.push({ pathname: "/(tabs)/reflections", params: { prompt: `Reflecting on ${verse.reference}: "${verse.verse}"` } });
  };

  const openVerse = () => verse && Linking.openURL(verse.bible_link);

  const currentResponse = qaResponses[style];

  return (
    <ScreenBackground>
      <ScreenHeader />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Scripture</Text>
        <Text style={styles.title}>Today's verse</Text>

        <Animated.View style={[styles.banner, { opacity: bannerOpacity }]} testID="rotating-banner">
          <Text style={styles.bannerText}>{BANNER_QUOTES[bannerIdx]}</Text>
        </Animated.View>

        {loading || !verse ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.gold} />
          </View>
        ) : (
          <>
            <View style={styles.verseCard} testID="verse-card">
              <Text style={styles.translationTag}>NLT</Text>
              <Text style={styles.verseText}>"{verse.verse}"</Text>
              <Pressable onPress={openVerse} testID="verse-bible-link" style={styles.refRow}>
                <Text style={styles.verseLink}>{verse.reference}</Text>
                <Ionicons name="open-outline" size={14} color={colors.goldHover} />
              </Pressable>
            </View>

            <View style={styles.reactionsRow} testID="reactions-row">
              {REACTIONS.map((r) => (
                <Pressable
                  key={r.key}
                  style={styles.reactionBtn}
                  onPress={() => handleReact(r.key)}
                  testID={`react-${r.key}`}
                >
                  <Ionicons name={r.icon} size={20} color={colors.gold} />
                  <Text style={styles.reactionLabel}>{r.label}</Text>
                  <Text style={styles.reactionCount}>{counts[r.key] ?? 0}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Devotional</Text>
            <View style={styles.devotionalCard} testID="devotional-card">
              <Text style={styles.devotionalText}>{verse.devotional}</Text>
            </View>

            <Text style={styles.sectionLabel}>Discuss</Text>
            <View style={styles.qaWrap}>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="Ask a theological question…"
                placeholderTextColor="rgba(250,248,243,0.35)"
                multiline
                style={styles.qaInput}
                testID="theological-question-input"
              />
              <View style={styles.styleSegment}>
                {STYLES.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => handleStyleChange(s)}
                    style={[styles.stylePill, style === s && styles.stylePillActive]}
                    testID={`style-pill-${s}`}
                  >
                    <Text style={[styles.stylePillText, style === s && styles.stylePillTextActive]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={submitQuestion}
                disabled={!question.trim() || qaLoading}
                style={[styles.askBtn, (!question.trim() || qaLoading) && styles.askBtnDisabled]}
                testID="ask-question-button"
              >
                {qaLoading && !currentResponse ? (
                  <ActivityIndicator color={colors.bgTop} />
                ) : (
                  <Text style={styles.askBtnText}>Ask</Text>
                )}
              </Pressable>
              {(qaLoading && !currentResponse) ? (
                <View style={styles.qaResponseCard}>
                  <ActivityIndicator color={colors.gold} />
                </View>
              ) : !!currentResponse ? (
                <View style={styles.qaResponseCard} testID="qa-response">
                  <Text style={styles.qaResponseStyle}>{style}</Text>
                  <Text style={styles.qaResponseText}>{currentResponse}</Text>
                </View>
              ) : null}
            </View>

            <Pressable onPress={goReflect} style={styles.reflectCta} testID="want-to-reflect-button">
              <Text style={styles.reflectCtaText}>Reflect on this verse</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.gold} />
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingBottom: 64, gap: 14 },
  eyebrow: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginTop: 8 },
  title: { fontFamily: fonts.sansBold, fontSize: 28, color: colors.ivory, marginTop: 2, letterSpacing: -0.5 },
  banner: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    marginTop: 4,
  },
  bannerText: { fontFamily: fonts.sansMedium, color: colors.textSecondary, fontSize: 13, textAlign: "center", letterSpacing: 0.2 },
  loadingBox: { padding: 40, alignItems: "center" },
  verseCard: {
    backgroundColor: colors.ivory,
    borderRadius: 20,
    padding: 26,
    gap: 14,
    marginTop: 8,
  },
  translationTag: {
    alignSelf: "flex-start",
    fontFamily: fonts.sansSemibold,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.goldHover,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.4)",
  },
  verseText: { fontFamily: fonts.serif, fontSize: 22, color: colors.onCard, lineHeight: 32 },
  refRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  verseLink: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.goldHover },
  reactionsRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  reactionBtn: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
  },
  reactionLabel: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.textSecondary, letterSpacing: 0.2 },
  reactionCount: { fontFamily: fonts.sansSemibold, color: colors.textMuted, fontSize: 11 },
  sectionLabel: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginTop: 12 },
  devotionalCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
  },
  devotionalText: { fontFamily: fonts.serif, color: colors.ivory, fontSize: 16, lineHeight: 26 },
  qaWrap: { gap: 12 },
  qaInput: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    color: colors.ivory,
    fontFamily: fonts.sans,
    fontSize: 15,
    minHeight: 70,
    textAlignVertical: "top",
  },
  styleSegment: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 12,
  },
  stylePill: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  stylePillActive: { backgroundColor: colors.gold },
  stylePillText: { fontFamily: fonts.sansSemibold, color: colors.textSecondary, fontSize: 13 },
  stylePillTextActive: { color: colors.bgTop },
  askBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  askBtnDisabled: { opacity: 0.4 },
  askBtnText: { fontFamily: fonts.sansBold, color: colors.bgTop, fontSize: 15, letterSpacing: 0.3 },
  qaResponseCard: {
    backgroundColor: colors.ivory,
    borderRadius: 18,
    padding: 22,
    gap: 8,
    minHeight: 80,
    justifyContent: "center",
  },
  qaResponseStyle: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2, color: colors.goldHover, textTransform: "uppercase" },
  qaResponseText: { fontFamily: fonts.serif, color: colors.onCard, fontSize: 16, lineHeight: 24 },
  reflectCta: {
    alignSelf: "center",
    paddingVertical: 16,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reflectCtaText: { fontFamily: fonts.sansSemibold, color: colors.gold, fontSize: 14 },
});
