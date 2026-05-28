// Scripture Unplugged — daily verse with rotating banner, reactions, devotional, Q&A.
import { useEffect, useMemo, useRef, useState } from "react";
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

type ReactionKey = "🙏" | "❤️" | "🔥" | "💡";
const REACTIONS: ReactionKey[] = ["🙏", "❤️", "🔥", "💡"];
type Style = "Devotional" | "Theologian" | "Pastoral";
const STYLES: Style[] = ["Devotional", "Theologian", "Pastoral"];

export default function ScriptureScreen() {
  const router = useRouter();
  const [verse, setVerse] = useState<{ verse: string; reference: string; verse_id: string; bible_link: string; devotional: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({ "🙏": 0, "❤️": 0, "🔥": 0, "💡": 0 });
  const [bannerIdx, setBannerIdx] = useState(0);
  const bannerOpacity = useRef(new Animated.Value(1)).current;

  const [question, setQuestion] = useState("");
  const [style, setStyle] = useState<Style>("Devotional");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaResponse, setQaResponse] = useState<string>("");

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

  // Rotating banner quote
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 400, useNativeDriver: true, easing: Easing.in(Easing.quad) }).start(() => {
        setBannerIdx((i) => (i + 1) % BANNER_QUOTES.length);
        Animated.timing(bannerOpacity, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.quad) }).start();
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [bannerOpacity]);

  const handleReact = async (emoji: ReactionKey) => {
    if (!verse) return;
    setCounts((c) => ({ ...c, [emoji]: (c[emoji] ?? 0) + 1 }));
    try {
      const res = await api.reactToVerse(verse.verse_id, emoji);
      setCounts((c) => ({ ...c, [emoji]: res.count }));
    } catch (e) {
      console.warn("react failed", e);
    }
  };

  const submitQuestion = async () => {
    if (!question.trim() || !verse || qaLoading) return;
    setQaLoading(true);
    setQaResponse("");
    try {
      const r = await api.theologicalQuestion(question.trim(), `"${verse.verse}" — ${verse.reference}`, style);
      setQaResponse(r.response);
    } catch (e) {
      console.warn("theological question failed", e);
    } finally {
      setQaLoading(false);
    }
  };

  const goReflect = () => {
    if (!verse) return;
    router.push({ pathname: "/(tabs)/reflections", params: { prompt: `Reflecting on ${verse.reference}: "${verse.verse}"` } });
  };

  const openVerse = () => verse && Linking.openURL(verse.bible_link);

  return (
    <ScreenBackground>
      <ScreenHeader />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Scripture Unplugged</Text>

        <Animated.View style={[styles.banner, { opacity: bannerOpacity }]} testID="rotating-banner">
          <Text style={styles.bannerText}>"{BANNER_QUOTES[bannerIdx]}"</Text>
        </Animated.View>

        {loading || !verse ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.gold} />
          </View>
        ) : (
          <>
            <View style={styles.verseCard} testID="verse-card">
              <Text style={styles.verseRefTop}>Today's Verse</Text>
              <Text style={styles.verseText}>"{verse.verse}"</Text>
              <Pressable onPress={openVerse} testID="verse-bible-link">
                <Text style={styles.verseLink}>{verse.reference}  ↗</Text>
              </Pressable>
            </View>

            <View style={styles.reactionsRow} testID="reactions-row">
              {REACTIONS.map((r) => (
                <Pressable
                  key={r}
                  style={styles.reactionBtn}
                  onPress={() => handleReact(r)}
                  testID={`react-${r}`}
                >
                  <Text style={styles.reactionEmoji}>{r}</Text>
                  <Text style={styles.reactionCount}>{counts[r] ?? 0}</Text>
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
                    onPress={() => setStyle(s)}
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
                {qaLoading ? (
                  <ActivityIndicator color={colors.bgTop} />
                ) : (
                  <Text style={styles.askBtnText}>Ask</Text>
                )}
              </Pressable>
              {!!qaResponse && (
                <View style={styles.qaResponseCard} testID="qa-response">
                  <Text style={styles.qaResponseStyle}>{style}</Text>
                  <Text style={styles.qaResponseText}>{qaResponse}</Text>
                </View>
              )}
            </View>

            <Pressable onPress={goReflect} style={styles.reflectCta} testID="want-to-reflect-button">
              <Text style={styles.reflectCtaText}>Want to reflect on this? →</Text>
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
  banner: {
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    marginTop: 4,
  },
  bannerText: { fontFamily: fonts.serifItalic, fontStyle: "italic", color: colors.ivory, fontSize: 14, textAlign: "center" },
  loadingBox: { padding: 40, alignItems: "center" },
  verseCard: {
    backgroundColor: colors.ivory,
    borderRadius: 28,
    padding: 26,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
    gap: 12,
    marginTop: 8,
  },
  verseRefTop: { fontFamily: fonts.sansSemibold, fontSize: 10, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase" },
  verseText: { fontFamily: fonts.serif, fontSize: 22, color: colors.onCard, lineHeight: 32 },
  verseLink: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.goldHover, marginTop: 4 },
  reactionsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  reactionBtn: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
  },
  reactionEmoji: { fontSize: 22 },
  reactionCount: { fontFamily: fonts.sansSemibold, color: colors.textSecondary, fontSize: 12 },
  sectionLabel: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginTop: 12 },
  devotionalCard: {
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
  },
  devotionalText: { fontFamily: fonts.serif, color: colors.ivory, fontSize: 16, lineHeight: 26 },
  qaWrap: { gap: 12 },
  qaInput: {
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 20,
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
    borderRadius: 999,
  },
  stylePill: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: "center" },
  stylePillActive: { backgroundColor: colors.gold },
  stylePillText: { fontFamily: fonts.sansSemibold, color: colors.textSecondary, fontSize: 12 },
  stylePillTextActive: { color: colors.bgTop },
  askBtn: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  askBtnDisabled: { opacity: 0.4 },
  askBtnText: { fontFamily: fonts.sansBold, color: colors.bgTop, fontSize: 15, letterSpacing: 0.3 },
  qaResponseCard: {
    backgroundColor: colors.ivory,
    borderRadius: 24,
    padding: 22,
    gap: 8,
  },
  qaResponseStyle: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2, color: colors.goldHover, textTransform: "uppercase" },
  qaResponseText: { fontFamily: fonts.serif, color: colors.onCard, fontSize: 16, lineHeight: 24 },
  reflectCta: {
    alignSelf: "center",
    paddingVertical: 16,
    marginTop: 8,
  },
  reflectCtaText: { fontFamily: fonts.sansSemibold, color: colors.gold, fontSize: 14 },
});
