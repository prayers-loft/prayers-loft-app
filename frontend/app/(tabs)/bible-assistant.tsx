// Bible Assistant. AI-powered study & devotional tools, in a dedicated tab.
//
// This tab houses the two modes that previously lived embedded inside Scripture:
//   1. "Bible Questions"  → mode=question  (free-form Q&A)
//   2. "Write Devotional" → mode=devotional (topic → structured devotional)
//
// All backend APIs, prompts, and share machinery are unchanged. This is purely
// a navigation/layout relocation so Scripture can become a focused reading +
// reflection surface, while Bible Assistant becomes the explicit study room.
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { ShareImageModal, ShareKind } from "@/src/components/ShareImageModal";
import { getShareExcerpt } from "@/src/lib/share-excerpt";
import { showToast } from "@/src/components/Toast";
import { StructuredDevotional } from "@/src/components/StructuredDevotional";
import { EmptyState } from "@/src/components/EmptyState";
import {
  BIBLE_ASSISTANT_EMPTY,
  BIBLE_ASSISTANT_ERROR,
} from "@/src/lib/empty-state-copy";
import type { StructuredDevotional as StructuredDevotionalType } from "@/src/lib/daily-devotional";

type Style = "Devotional" | "Theologian";
const STYLES: Style[] = ["Devotional", "Theologian"];

export default function BibleAssistantScreen() {
  const [question, setQuestion] = useState("");
  const [lastAskedQuestion, setLastAskedQuestion] = useState<string>("");
  const [style, setStyle] = useState<Style>("Devotional");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState(false);
  const [qaResponses, setQaResponses] = useState<Record<Style, string>>({ Devotional: "", Theologian: "" });
  // Structured devotional payload — only ever populated for Devotional style
  // (mode=devotional on the backend). Null for Theologian (Bible Questions).
  const [devoStructured, setDevoStructured] = useState<StructuredDevotionalType | null>(null);
  const fade = useRef(new Animated.Value(1)).current;

  // Share state ----------------------------------------------------------
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePreparing, setSharePreparing] = useState(false);
  const [sharePayload, setSharePayload] = useState<ShareKind | null>(null);

  const runQA = useCallback(
    async (q: string, s: Style) => {
      if (!q.trim()) return;
      setQaLoading(true);
      setQaError(false);
      try {
        // mode=question → Bible Q&A (plain text); mode=devotional → structured JSON.
        const mode: "question" | "devotional" = s === "Theologian" ? "question" : "devotional";
        const r = await api.bibleAssistant(mode, q.trim());
        setQaResponses((prev) => ({ ...prev, [s]: r.response }));
        if (mode === "devotional") {
          // Cache the structured payload separately. Falls back gracefully to
          // the flat text card when the LLM didn't produce parseable JSON.
          setDevoStructured(r.response_structured ?? null);
        } else {
          setDevoStructured(null);
        }
        Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
      } catch (e) {
        console.warn("bible assistant failed", e);
        setQaError(true);
        showToast({
          variant: "error",
          title: s === "Theologian" ? "Couldn't answer your question" : "Couldn't generate devotional",
          message: e instanceof Error ? e.message : "Please check your connection and try again.",
          duration: 5000,
        });
      } finally {
        setQaLoading(false);
      }
    },
    [fade]
  );

  const submitQuestion = async () => {
    if (!question.trim() || qaLoading) return;
    const q = question.trim();
    setLastAskedQuestion(q);
    setQaResponses({ Devotional: "", Theologian: "" });
    setQaError(false);
    await runQA(q, style);
  };

  const handleStyleChange = async (s: Style) => {
    if (s === style) return;
    setStyle(s);
    if (!lastAskedQuestion || qaResponses[s]) return;
    await runQA(lastAskedQuestion, s);
  };

  const openShare = async () => {
    if (!currentResponse || sharePreparing) return;
    setSharePreparing(true);
    try {
      const excerpt = await getShareExcerpt(currentResponse, style, { question: lastAskedQuestion });
      setSharePayload({
        kind: "qa",
        excerpt,
        fullText: currentResponse,
        reference: "",
        question: lastAskedQuestion,
        style,
      });
      setShareOpen(true);
    } catch (e) {
      console.warn("bible-assistant share prep failed", e);
    } finally {
      setSharePreparing(false);
    }
  };

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
          <Text style={styles.eyebrow}>Study</Text>
          <Text style={styles.title}>Study with care.</Text>
          <Text style={styles.subtitle}>
            Ask any Bible or theology question, or generate a devotional on a topic that's on your heart.
          </Text>
        </View>

        <View style={styles.qaWrap}>
          <View style={styles.qaInputWrap}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder={
                style === "Theologian"
                  ? "Ask any Bible or theology question..."
                  : "Enter a topic you'd like to study or pray about..."
              }
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
                <Text style={[styles.stylePillText, style === s && styles.stylePillTextActive]}>
                  {s === "Theologian" ? "Bible Questions" : "Devotional"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Example chips — populate input on tap. Mode-aware. */}
          <View style={styles.chipsRow} testID="bible-assistant-chips">
            {(style === "Theologian"
              ? ["Salvation", "Forgiveness", "Prayer", "Faith"]
              : ["Anxiety", "Purpose", "Discipline", "Trust"]
            ).map((chip) => (
              <Pressable
                key={chip}
                onPress={() => setQuestion(chip)}
                style={styles.chip}
                testID={`chip-${chip.toLowerCase()}`}
                accessibilityRole="button"
                accessibilityLabel={`Use example: ${chip}`}
              >
                <Text style={styles.chipText}>{chip}</Text>
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
              <Text style={styles.askBtnText}>
                {style === "Theologian" ? "Ask" : "Generate"}
              </Text>
            )}
          </Pressable>

          {qaLoading && !currentResponse ? (
            <View style={styles.qaResponseCard}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : !!currentResponse ? (
            <Animated.View style={{ opacity: fade, gap: 12 }} testID="qa-response">
              {/* Header strip (style label + share). For the Devotional path
                  this header sits above the structured card so the share
                  affordance is still discoverable. */}
              <View style={[styles.qaResponseCard, styles.qaResponseHeaderStrip]}>
                <View style={styles.qaResponseHeader}>
                  <Text style={styles.qaResponseStyle}>{style}</Text>
                  <Pressable
                    onPress={openShare}
                    hitSlop={8}
                    style={styles.qaShareBtn}
                    testID="share-qa-button"
                    accessibilityRole="button"
                    accessibilityLabel="Share this insight"
                  >
                    {sharePreparing ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Ionicons name="share-outline" size={16} color={colors.accent} />
                    )}
                  </Pressable>
                </View>
              </View>

              {style === "Devotional" && devoStructured ? (
                // Magazine-style devotional card. Same renderer as Scripture
                // so visual treatment stays identical across both surfaces.
                <StructuredDevotional devo={devoStructured} testID="qa-structured-devotional" />
              ) : (
                // Theologian (Q&A) — or Devotional fallback when JSON parse
                // failed on the backend — renders as a single prose block.
                <View style={styles.qaResponseCard}>
                  <Text style={styles.qaResponseText}>{currentResponse}</Text>
                </View>
              )}
            </Animated.View>
          ) : (
            <EmptyState
              icon={qaError ? "cloud-offline-outline" : "school-outline"}
              variant={qaError ? "error" : "info"}
              title={qaError ? BIBLE_ASSISTANT_ERROR.title : BIBLE_ASSISTANT_EMPTY.title}
              body={qaError ? BIBLE_ASSISTANT_ERROR.body : BIBLE_ASSISTANT_EMPTY.body}
              testID={qaError ? "bible-assistant-error" : "bible-assistant-empty"}
            />
          )}
        </View>
      </KeyboardAwareScrollView>

      {sharePayload && (
        <ShareImageModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
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
  subtitle: { fontFamily: fonts.serif, fontSize: 15, color: colors.textSecondary, marginTop: 10, lineHeight: 22 },
  qaWrap: { gap: 12, marginTop: 8 },
  qaInputWrap: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    padding: 4,
  },
  qaInput: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 15,
    minHeight: 80,
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
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
    letterSpacing: 0.1,
  },
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
  // Slimmer wrapper used when the structured devotional card follows below;
  // we drop the minHeight so the header strip hugs its content tightly.
  qaResponseHeaderStrip: {
    paddingVertical: 14,
    minHeight: 0,
    gap: 0,
  },
  qaResponseHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  qaResponseStyle: { fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 2, color: colors.accent, textTransform: "uppercase" },
  qaShareBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  qaResponseText: { fontFamily: fonts.serif, color: colors.text, fontSize: 16, lineHeight: 25 },
});
