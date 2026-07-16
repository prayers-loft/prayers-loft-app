// -----------------------------------------------------------------------------
// Walk conversation — the streaming chat with the discipleship companion.
//
// UI voice discipline (matches walk.SYSTEM_PROMPT):
//   • Assistant messages are rendered as a single flowing text block. When
//     the model uses the phrases "You said", "Scripture says", or
//     "I'm wondering" / "It sounds like", we visually distinguish each
//     phrase inline via a bold label and (for Scripture) a subtle accent
//     stripe on the left. We DO NOT force a three-block layout.
//   • Ending the session runs extraction on the server and returns any
//     candidates to review. The user taps to save or dismiss each one.
//
// State transitions:
//   loading → starting session
//   ready   → normal chat
//   streaming → assistant reply arriving (append chunks)
//   ended   → showing extraction candidates for review
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { colors, fonts, spacing, radii } from "@/src/theme/theme";
import {
  createMemory,
  endWalkSession,
  MemoryCandidate,
  startWalkSession,
  streamWalkMessage,
  WalkMessage,
} from "@/src/lib/walk-api";

type Phase = "loading" | "ready" | "streaming" | "ended";

export default function WalkConversationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WalkMessage[]>([]);
  const [pendingText, setPendingText] = useState(""); // input box
  const [streamBuffer, setStreamBuffer] = useState<string>(""); // in-flight assistant text
  const [candidates, setCandidates] = useState<MemoryCandidate[] | null>(null);
  const [savedFromExtraction, setSavedFromExtraction] = useState<
    { kind: string; content: string; scripture_ref: string | null }[]
  >([]);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Start a new session on mount.
  useEffect(() => {
    (async () => {
      try {
        const s = await startWalkSession();
        setSessionId(s.id);
        setMessages([
          {
            id: "opener",
            role: "assistant",
            content: s.opening_message,
            at: new Date().toISOString(),
          },
        ]);
        setPhase("ready");
      } catch {
        setError(
          "Something's off on our end. Try again in a moment.",
        );
        setPhase("ended");
      }
    })();
    return () => {
      // Cancel any in-flight stream on unmount.
      try {
        abortRef.current?.();
      } catch {}
    };
  }, []);

  // Autoscroll to bottom on new content.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, streamBuffer]);

  const send = useCallback(() => {
    const text = pendingText.trim();
    if (!text || !sessionId || phase !== "ready") return;
    setPendingText("");
    setError(null);
    // Optimistically append the user turn — the backend has already persisted it.
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: text,
        at: new Date().toISOString(),
      },
    ]);
    setPhase("streaming");
    setStreamBuffer("");
    let accumulated = "";
    const abort = streamWalkMessage(sessionId, text, {
      onChunk: (chunk) => {
        accumulated += chunk;
        setStreamBuffer(accumulated);
      },
      onDone: (messageId) => {
        setMessages((prev) => [
          ...prev,
          {
            id: messageId || `local-${Date.now()}`,
            role: "assistant",
            content: accumulated,
            at: new Date().toISOString(),
          },
        ]);
        setStreamBuffer("");
        setPhase("ready");
      },
      onError: (e) => {
        // Preserve whatever partial text we got.
        if (accumulated) {
          setMessages((prev) => [
            ...prev,
            {
              id: `local-${Date.now()}`,
              role: "assistant",
              content: accumulated,
              at: new Date().toISOString(),
            },
          ]);
        }
        setStreamBuffer("");
        setError("I lost the thread for a moment. Please try again.");
        setPhase("ready");
        console.warn("[walk] stream error", e?.message);
      },
    });
    abortRef.current = abort;
  }, [pendingText, sessionId, phase]);

  const closeAndExtract = useCallback(async () => {
    if (!sessionId) {
      router.back();
      return;
    }
    try {
      // Cancel any in-flight stream first so we don't race the /end.
      abortRef.current?.();
      setPhase("loading");
      const res = await endWalkSession(sessionId);
      // Auto-saved items are already durable; only surface pending candidates
      // for optional review. We still SHOW the auto-saved items so the user
      // knows what was captured (with a subtle "already saved" affordance).
      setCandidates(res.candidates_pending);
      setSavedFromExtraction(
        (res.candidates_saved || []).map((s) => ({
          kind: s.kind,
          content: s.content,
          scripture_ref: s.scripture_ref,
        })),
      );
      setPhase("ended");
    } catch {
      // Best-effort close: still show the ended state.
      setCandidates([]);
      setPhase("ended");
    }
  }, [sessionId, router]);

  const savePendingCandidate = useCallback(
    async (idx: number, c: MemoryCandidate) => {
      try {
        await createMemory({
          kind: c.kind,
          content: c.content,
          scripture_ref: c.scripture_ref,
          confirmation_source: "explicit_user_action",
          source_session_id: sessionId,
        });
        setSavedIds((prev) => new Set(prev).add(idx));
      } catch {
        // Silent — the user can retry via tab reload if it truly failed.
      }
    },
    [sessionId],
  );

  return (
    <ScreenBackground>
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: phase !== "streaming",
        }}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={closeAndExtract}
          hitSlop={12}
          testID="walk-close"
          accessibilityRole="button"
          accessibilityLabel="Close conversation"
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Walk</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.chatContainer}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} content={m.content} />
          ))}
          {phase === "streaming" && streamBuffer.length > 0 && (
            <MessageBubble role="assistant" content={streamBuffer} pulsing />
          )}
          {phase === "streaming" && streamBuffer.length === 0 && (
            <View style={styles.thinking} testID="walk-thinking">
              <ActivityIndicator size="small" color={colors.textTertiary} />
              <Text style={styles.thinkingText}>Listening…</Text>
            </View>
          )}
          {phase === "loading" && messages.length === 0 && (
            <View style={styles.thinking}>
              <ActivityIndicator color={colors.textTertiary} />
            </View>
          )}
          {phase === "ended" && (
            <EndedPanel
              candidates={candidates ?? []}
              savedFromExtraction={savedFromExtraction}
              savedIndices={savedIds}
              onSave={savePendingCandidate}
              onDone={() => router.back()}
            />
          )}
          {error ? <Text style={styles.errorLine}>{error}</Text> : null}
        </ScrollView>

        {(phase === "ready" || phase === "streaming") && (
          <View
            style={[
              styles.composerRow,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            <TextInput
              value={pendingText}
              onChangeText={setPendingText}
              placeholder="Type when you're ready…"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              multiline
              editable={phase === "ready"}
              maxLength={2000}
              testID="walk-input"
            />
            <Pressable
              onPress={phase === "ready" ? send : undefined}
              disabled={phase !== "ready" || !pendingText.trim()}
              style={[
                styles.sendBtn,
                (phase !== "ready" || !pendingText.trim()) && styles.sendBtnDisabled,
              ]}
              testID="walk-send"
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={
                  phase === "ready" && pendingText.trim() ? colors.bg : colors.textTertiary
                }
              />
            </Pressable>
          </View>
        )}
        {phase === "ready" && messages.length > 1 && (
          <Pressable
            onPress={closeAndExtract}
            style={styles.closeSessionBtn}
            testID="walk-close-session"
          >
            <Text style={styles.closeSessionText}>Close this conversation</Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// Message bubble — the three-voice inline styling.
// ---------------------------------------------------------------------------
function MessageBubble({
  role,
  content,
  pulsing,
}: {
  role: "user" | "assistant";
  content: string;
  pulsing?: boolean;
}) {
  // Always compute segments so the hook ordering is stable across renders,
  // even when we render the user branch below.
  const segments = useMemo(() => splitAssistantVoices(content), [content]);
  if (role === "user") {
    return (
      <View style={styles.userBubbleWrap}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{content}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.assistantBubbleWrap}>
      <View style={styles.assistantBubble}>
        {segments.map((seg, i) => (
          <VoiceSegment key={i} segment={seg} last={i === segments.length - 1 && !!pulsing} />
        ))}
      </View>
    </View>
  );
}

type Voice = "reflect" | "scripture" | "wondering" | "neutral";
type Segment = { voice: Voice; label: string | null; body: string };

// Recognize the phrase-tags used by the prompt:
//   "You said..."               → reflect
//   "Scripture says..."         → scripture (accent stripe)
//   "I'm wondering..."          → wondering
//   "It sounds like..."         → wondering
// Anything else → neutral.
const VOICE_MARKERS: { voice: Voice; regex: RegExp; label: string }[] = [
  { voice: "reflect", regex: /(^|\n\s*)You said[,\s—-]/i, label: "You said" },
  { voice: "scripture", regex: /(^|\n\s*)Scripture says[,\s—:-]/i, label: "Scripture says" },
  { voice: "wondering", regex: /(^|\n\s*)I'?m wondering[,\s—-]/i, label: "I'm wondering" },
  { voice: "wondering", regex: /(^|\n\s*)It sounds like[,\s—-]/i, label: "It sounds like" },
];

function splitAssistantVoices(content: string): Segment[] {
  // Strip markdown bold/italic wrappers so we can detect "**Scripture says:**"
  // and "_You said_" the same way as plain-text markers.
  const cleaned = content
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!_)__(?!_)(.+?)(?<!_)__(?!_)/g, "$1");
  const hits: { voice: Voice; label: string; start: number; markerEnd: number }[] = [];
  for (const m of VOICE_MARKERS) {
    const re = new RegExp(m.regex.source, m.regex.flags.includes("g") ? m.regex.flags : m.regex.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(cleaned))) {
      const start = match.index + (match[1]?.length ?? 0);
      hits.push({
        voice: m.voice,
        label: m.label,
        start,
        markerEnd: match.index + match[0].length,
      });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  if (hits.length === 0) {
    return [{ voice: "neutral", label: null, body: cleaned.trim() }];
  }
  const segments: Segment[] = [];
  if (hits[0].start > 0) {
    const pre = cleaned.slice(0, hits[0].start).trim();
    if (pre) segments.push({ voice: "neutral", label: null, body: pre });
  }
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const nextStart = i + 1 < hits.length ? hits[i + 1].start : cleaned.length;
    const body = cleaned.slice(h.markerEnd, nextStart).trim();
    segments.push({ voice: h.voice, label: h.label, body });
  }
  return segments;
}

function VoiceSegment({ segment, last }: { segment: Segment; last: boolean }) {
  const { voice, label, body } = segment;
  if (voice === "scripture") {
    return (
      <View style={styles.scriptureBlock} testID="walk-voice-scripture">
        <Text style={styles.voiceLabelScripture}>{label ?? "Scripture says"}</Text>
        <Text style={styles.scriptureBody}>{body}</Text>
      </View>
    );
  }
  if (voice === "reflect") {
    return (
      <View style={styles.voiceBlock} testID="walk-voice-reflect">
        <Text style={styles.voiceLabelReflect}>{label ?? "You said"}</Text>
        <Text style={styles.assistantText}>{body}</Text>
      </View>
    );
  }
  if (voice === "wondering") {
    return (
      <View style={styles.voiceBlock} testID="walk-voice-wondering">
        <Text style={styles.voiceLabelWondering}>{label ?? "I'm wondering"}</Text>
        <Text style={styles.assistantText}>{body}</Text>
      </View>
    );
  }
  return (
    <View style={styles.voiceBlock}>
      <Text style={[styles.assistantText, last && styles.assistantTextPulsing]}>
        {body}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// End-of-session review — pending memory candidates
// ---------------------------------------------------------------------------
function EndedPanel({
  candidates,
  savedFromExtraction,
  savedIndices,
  onSave,
  onDone,
}: {
  candidates: MemoryCandidate[];
  savedFromExtraction: { kind: string; content: string; scripture_ref: string | null }[];
  savedIndices: Set<number>;
  onSave: (idx: number, c: MemoryCandidate) => void;
  onDone: () => void;
}) {
  const hasAnyContent = savedFromExtraction.length > 0 || candidates.length > 0;
  return (
    <View style={styles.endedPanel} testID="walk-ended-panel">
      <Text style={styles.endedTitle}>Take a breath.</Text>
      {hasAnyContent ? (
        <Text style={styles.endedBody}>
          {"Here's what I heard. I've kept the things you said directly — you can remove any of them later from Walk."}
        </Text>
      ) : (
        <Text style={styles.endedBody}>
          {"Anything from today you'd like me to remember for next time?"}
        </Text>
      )}
      {savedFromExtraction.length > 0 && (
        <View style={styles.savedList} testID="walk-saved-from-extraction">
          <Text style={styles.savedListHeader}>Saved for next time</Text>
          {savedFromExtraction.map((s, i) => (
            <View key={`saved-${i}`} style={[styles.candidateCard, styles.candidateCardSaved]}>
              <Text style={styles.candidateKind}>{prettyKind(s.kind)}</Text>
              <Text style={styles.candidateText}>{s.content}</Text>
              {s.scripture_ref ? (
                <Text style={styles.candidateRef}>{s.scripture_ref}</Text>
              ) : null}
              <View style={styles.savedRow}>
                <Ionicons name="checkmark" size={16} color={colors.accent} />
                <Text style={styles.savedText}>Saved</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {candidates.length > 0 && (
        <View style={styles.pendingList} testID="walk-pending-candidates">
          <Text style={styles.savedListHeader}>Would you like me to remember these too?</Text>
          {candidates.map((c, i) => (
            <View key={`pend-${i}`} style={styles.candidateCard}>
              <Text style={styles.candidateKind}>{prettyKind(c.kind)}</Text>
              <Text style={styles.candidateText}>{c.content}</Text>
              {c.scripture_ref ? (
                <Text style={styles.candidateRef}>{c.scripture_ref}</Text>
              ) : null}
              {savedIndices.has(i) ? (
                <View style={styles.savedRow}>
                  <Ionicons name="checkmark" size={16} color={colors.accent} />
                  <Text style={styles.savedText}>Saved</Text>
                </View>
              ) : (
                <View style={styles.candidateActions}>
                  <Pressable
                    onPress={() => onSave(i, c)}
                    style={styles.saveBtn}
                    testID={`walk-save-candidate-${i}`}
                  >
                    <Text style={styles.saveBtnText}>Save</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
      {!hasAnyContent && (
        <Text style={styles.endedHint}>
          {"I didn't hear anything worth flagging. That's fine — we'll pick up when you're ready."}
        </Text>
      )}
      <Pressable onPress={onDone} style={styles.doneBtn} testID="walk-done">
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

function prettyKind(k: string): string {
  switch (k) {
    case "prayer":
      return "PRAYER";
    case "struggle":
      return "STRUGGLE";
    case "lesson":
      return "LESSON";
    case "commitment":
      return "COMMITMENT";
    default:
      return k.toUpperCase();
  }
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  chatContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: 10,
  },
  userBubbleWrap: {
    alignItems: "flex-end",
    marginTop: spacing.sm,
  },
  userBubble: {
    maxWidth: "82%",
    backgroundColor: colors.accentSoft,
    borderRadius: radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  userText: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  assistantBubbleWrap: {
    alignItems: "flex-start",
    marginTop: spacing.sm,
  },
  assistantBubble: {
    maxWidth: "92%",
    gap: 8,
  },
  voiceBlock: {},
  scriptureBlock: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 4,
    gap: 4,
  },
  voiceLabelReflect: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  voiceLabelScripture: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  voiceLabelWondering: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
    fontStyle: "italic",
  },
  assistantText: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textPrimary,
  },
  assistantTextPulsing: {
    opacity: 0.9,
  },
  scriptureBody: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textPrimary,
    fontStyle: "italic",
  },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  thinkingText: {
    fontFamily: fonts.sansRegular,
    fontSize: 13,
    color: colors.textTertiary,
    fontStyle: "italic",
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: radii.lg,
    backgroundColor: colors.surface1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  sendBtnDisabled: {
    backgroundColor: colors.surface2,
  },
  closeSessionBtn: {
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  closeSessionText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  errorLine: {
    marginTop: spacing.md,
    fontFamily: fonts.sansRegular,
    fontSize: 13,
    color: colors.textTertiary,
    fontStyle: "italic",
    textAlign: "center",
  },
  endedPanel: {
    marginTop: spacing.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  endedTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.textPrimary,
  },
  endedBody: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  endedHint: {
    fontFamily: fonts.sansRegular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textTertiary,
    fontStyle: "italic",
    marginTop: spacing.sm,
  },
  candidateCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  candidateCardSaved: {
    borderColor: "rgba(200,169,107,0.20)",
  },
  savedList: {
    marginTop: spacing.md,
    gap: 6,
  },
  pendingList: {
    marginTop: spacing.md,
    gap: 6,
  },
  savedListHeader: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textTertiary,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: spacing.md,
    marginBottom: 2,
  },
  candidateKind: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 1.5,
  },
  candidateText: {
    fontFamily: fonts.sansRegular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  candidateRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  candidateActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  saveBtnText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.accent,
    letterSpacing: 0.3,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  savedText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.accent,
  },
  doneBtn: {
    marginTop: spacing.lg,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  doneText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.bg,
    letterSpacing: 0.3,
  },
});
