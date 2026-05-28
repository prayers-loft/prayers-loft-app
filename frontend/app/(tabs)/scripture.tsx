// Scripture. Editorial, immersive verse card with subtle interactions.
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

const todayLabel = () =>
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

export default function ScriptureScreen() {
  const router = useRouter();
  const [verse, setVerse] = useState<{ verse: string; reference: string; verse_id: string; bible_link: string; devotional: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({ pray: 0, love: 0, fire: 0, insight: 0 });
  const [bannerIdx, setBannerIdx] = useState(0);
  const bannerOpacity = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;

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
        Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
      } catch (e) {
        console.warn("daily verse load failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [fade]);

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 350, useNativeDriver: true, easing: Easing.in(Easing.quad) }).start(() => {
        setBannerIdx((i) => (i + 1) % BANNER_QUOTES.length);
        Animated.timing(bannerOpacity, { toValue: 1, duration: 550, useNativeDriver: true, easing: Easing.out(Easing.quad) }).start();
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
    if (!lastAskedQuestion || qaResponses[s]) return;
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
        bottomOffset={32}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Scripture</Text>
          <Text style={styles.title}>Today's verse</Text>
          <Text style={styles.dateLine}>{todayLabel()}</Text>
        </View>

        {/* Rotating quote — minimal, no card */}
        <Animated.View style={[styles.banner, { opacity: bannerOpacity }]} testID="rotating-banner">
          <Text style={styles.bannerText}>{BANNER_QUOTES[bannerIdx]}</Text>
        </Animated.View>

        {loading || !verse ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <Animated.View style={{ opacity: fade, gap: 16 }}>
            {/* Verse card — editorial */}
            <View style={styles.verseCard} testID="verse-card">
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>NLT · {verse.reference}</Text>
                <Pressable onPress={openVerse} testID="verse-bible-link" hitSlop={8}>
                  <Ionicons name="open-outline" size={16} color={colors.accent} />
                </Pressable>
              </View>
              <Text style={styles.verseText}>"{verse.verse}"</Text>
            </View>

            {/* Reactions — minimal floating row */}
            <View style={styles.reactionsRow} testID="reactions-row">
              {REACTIONS.map((r) => (
                <ReactionButton
                  key={r.key}
                  icon={r.icon}
                  label={r.label}
                  count={counts[r.key] ?? 0}
                  onPress={() => handleReact(r.key)}
                  testID={`react-${r.key}`}
                />
              ))}
            </View>

            {/* Devotional — no card border, soft tint */}
            <View>
              <Text style={styles.sectionLabel}>Devotional</Text>
              <View style={styles.devotionalCard} testID="devotional-card">
                <Text style={styles.devotionalText}>{verse.devotional}</Text>
              </View>
            </View>

            {/* Discussion */}
            <View>
              <Text style={styles.sectionLabel}>Discuss</Text>
              <View style={styles.qaWrap}>
                <View style={styles.qaInputWrap}>
                  <TextInput
                    value={question}
                    onChangeText={setQuestion}
                    placeholder="Ask a theological question…"
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    style={styles.qaInput}
                    testID="theological-question-input"
                  />
                </View>
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
                    <ActivityIndicator color={colors.textOnAccent} />
                  ) : (
                    <Text style={styles.askBtnText}>Ask</Text>
                  )}
                </Pressable>
                {qaLoading && !currentResponse ? (
                  <View style={styles.qaResponseCard}>
                    <ActivityIndicator color={colors.accent} />
                  </View>
                ) : !!currentResponse ? (
                  <View style={styles.qaResponseCard} testID="qa-response">
                    <Text style={styles.qaResponseStyle}>{style}</Text>
                    <Text style={styles.qaResponseText}>{currentResponse}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <Pressable onPress={goReflect} style={styles.reflectCta} testID="want-to-reflect-button">
              <Text style={styles.reflectCtaText}>Reflect on this verse</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent} />
            </Pressable>
          </Animated.View>
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

function ReactionButton({ icon, label, count, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; count: number; onPress: () => void; testID: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={() => {
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.15, duration: 100, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }),
        ]).start();
        onPress();
      }}
      style={styles.reactionBtn}
      testID={testID}
    >
      <Animated.View style={[styles.reactionInner, { transform: [{ scale }] }]}>
        <Ionicons name={icon} size={18} color={colors.accent} />
        {count > 0 && <Text style={styles.reactionCount}>{count}</Text>}
      </Animated.View>
      <Text style={styles.reactionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 140, gap: 16 },
  hero: { marginTop: 12, marginBottom: 4 },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 },
  title: { fontFamily: fonts.sansBold, fontSize: 34, color: colors.text, letterSpacing: -0.8, lineHeight: 40 },
  dateLine: { fontFamily: fonts.sans, fontSize: 14, color: colors.textSecondary, marginTop: 8 },
  banner: { paddingVertical: 10, alignItems: "center" },
  bannerText: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 13, textAlign: "center", letterSpacing: 0.2 },
  loadingBox: { padding: 60, alignItems: "center" },
  verseCard: {
    backgroundColor: colors.surface1,
    borderRadius: 26,
    padding: 28,
    gap: 18,
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.accent, letterSpacing: 1.8, textTransform: "uppercase" },
  verseText: { fontFamily: fonts.serif, fontSize: 24, color: colors.text, lineHeight: 36, letterSpacing: 0.1 },
  reactionsRow: { flexDirection: "row", gap: 8 },
  reactionBtn: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
  },
  reactionInner: { flexDirection: "row", alignItems: "center", gap: 5 },
  reactionLabel: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.textSecondary },
  reactionCount: { fontFamily: fonts.sansSemibold, fontSize: 11, color: colors.accent },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.textTertiary,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  devotionalCard: {
    backgroundColor: colors.surface1,
    borderRadius: 20,
    padding: 22,
  },
  devotionalText: { fontFamily: fonts.serif, color: colors.text, fontSize: 16, lineHeight: 26 },
  qaWrap: { gap: 12 },
  qaInputWrap: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    padding: 4,
  },
  qaInput: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 15,
    minHeight: 70,
    textAlignVertical: "top",
    padding: 14,
    lineHeight: 22,
  },
  styleSegment: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 14,
  },
  stylePill: { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: "center" },
  stylePillActive: { backgroundColor: colors.accent },
  stylePillText: { fontFamily: fonts.sansMedium, color: colors.textSecondary, fontSize: 13 },
  stylePillTextActive: { color: colors.textOnAccent, fontFamily: fonts.sansSemibold },
  askBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  askBtnDisabled: { opacity: 0.35 },
  askBtnText: { fontFamily: fonts.sansSemibold, color: colors.textOnAccent, fontSize: 14, letterSpacing: 0.2 },
  qaResponseCard: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    padding: 22,
    gap: 8,
    minHeight: 80,
    justifyContent: "center",
  },
  qaResponseStyle: { fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 2, color: colors.accent, textTransform: "uppercase" },
  qaResponseText: { fontFamily: fonts.serif, color: colors.text, fontSize: 16, lineHeight: 25 },
  reflectCta: {
    alignSelf: "center",
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  reflectCtaText: { fontFamily: fonts.sansMedium, color: colors.accent, fontSize: 14 },
});
