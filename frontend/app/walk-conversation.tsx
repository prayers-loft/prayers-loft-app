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
  Alert,
  BackHandler,
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

// -----------------------------------------------------------------------------
// Local-time greeting helper.
//
// V5 intentionally REMOVED the AI-generated opener from /session/start to
// eliminate a Claude round-trip on cold-open (see backend walk.py:1213). The
// backend returns `opening_message: ""` and does NOT persist any assistant
// message in the transcript. To keep the conversation screen from opening
// blank, we render a lightweight static invitation based on the device's
// LOCAL time.
//
// Contract (per Build 26B UX ticket):
//   • Determined entirely on the client from Date.getHours().
//   • Never sent to the backend, never included in the transcript, never
//     persisted as an assistant message. Pure UI ornament.
//   • Disappears the moment the user's first message hits the transcript.
// -----------------------------------------------------------------------------
function getLocalTimeGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Good morning.";
  if (h >= 12 && h < 18) return "Good afternoon.";
  return "Good evening.";
}

export default function WalkConversationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WalkMessage[]>([]);
  const [pendingText, setPendingText] = useState(""); // input box
  const [streamBuffer, setStreamBuffer] = useState<string>(""); // in-flight assistant text
  // Static, client-computed greeting shown ONLY when the transcript is empty.
  // Locked to the local hour at session-open so it doesn't flip mid-conversation
  // if the user lingers across the noon or 6pm boundary. See getLocalTimeGreeting
  // above for the timezone-privacy contract (never sent to the backend).
  const [greeting, setGreeting] = useState<string>(() => getLocalTimeGreeting());
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
        // V5 (Build 26B) — the backend returns opening_message="" and
        // deliberately stores NO assistant message on the session. Inserting
        // an empty bubble caused the blank landing regression. Only seed
        // the transcript with an opener when the V4 fallback actually
        // provides one; otherwise leave the transcript empty and let the
        // static local-time greeting (rendered below) invite the user in.
        if (s.opening_message && s.opening_message.trim()) {
          setMessages([
            {
              id: "opener",
              role: "assistant",
              content: s.opening_message,
              at: new Date().toISOString(),
            },
          ]);
        } else {
          setMessages([]);
        }
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

  // Fire /end in the background so a "Leave conversation" tap can navigate
  // instantly while the server still runs extraction. Nothing awaits this.
  // Errors are swallowed silently — the memory the user already confirmed
  // (via typed "I commit to..." statements etc.) is captured server-side
  // during the /end call whether or not the client sticks around.
  const fireEndInBackground = useCallback(() => {
    if (!sessionId) return;
    // Abort any live stream first to avoid a race with /end.
    try {
      abortRef.current?.();
    } catch {}
    // Fire-and-forget; we do NOT await this.
    endWalkSession(sessionId).catch(() => {
      /* extraction is best-effort by design */
    });
  }, [sessionId]);

  // Decide what to do when the header back button OR Android hardware back
  // is pressed. Design principle: the Back button represents the user's
  // intent — leave immediately unless leaving would interrupt something
  // they are actively watching.
  //
  //   • phase === "streaming"  → confirm ("Stay" / "Leave"); on Leave abort
  //                              the stream, fire /end in background, and
  //                              navigate.
  //   • everything else        → navigate immediately. If a session exists,
  //                              /end is fired in the background so
  //                              extraction still runs.
  const handleBackPress = useCallback((): boolean => {
    // No session yet — just leave.
    if (!sessionId) {
      router.back();
      return true;
    }

    // Actively streaming a reply is the only case where leaving loses
    // something the user is watching. Confirm on native; on web fall
    // through (RN Web's Alert has no multi-button UI).
    if (phase === "streaming" && Platform.OS !== "web") {
      Alert.alert(
        "The companion is still responding",
        "If you leave now, I'll finish processing this conversation in the background, but you won't see the rest of this reply.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              fireEndInBackground();
              router.back();
            },
          },
        ],
        { cancelable: true },
      );
      return true;
    }

    // Every other case: leave immediately. Extraction runs server-side
    // whether the user waits or not.
    fireEndInBackground();
    router.back();
    return true;
  }, [sessionId, phase, router, fireEndInBackground]);

  // Wire Android hardware back to the same handler.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // Return true = we handled it (don't let RN pop the stack itself).
      handleBackPress();
      return true;
    });
    return () => sub.remove();
  }, [handleBackPress]);

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

  // "Done" — the ended-panel CTA that closes out the conversation.
  //
  // Contract (Build 26B UX fix):
  //   • The session has ALREADY been persisted server-side via
  //     closeAndExtract → endWalkSession, so no additional save call.
  //   • Clear the entire local conversation state so the previous transcript,
  //     candidates, and session id cannot leak into a subsequent Walk. This
  //     protects against the "previous conversation is still visible" bug if
  //     the screen briefly renders during the pop animation.
  //   • Navigate explicitly to the Walk tab landing (fresh greeting screen).
  //     We use `router.replace` rather than `router.back()` so the behavior
  //     is deterministic even when the user deep-linked into the conversation
  //     (no back stack to pop) or the stack is otherwise in an odd state.
  //   • The next time the user taps Begin, a brand-new session is created —
  //     the Walk tab's own `useFocusEffect` re-runs the landing fetch so
  //     any commitments extracted from this session appear immediately.
  const handleDone = useCallback(() => {
    // Abort any lingering stream first — belt to closeAndExtract's braces.
    try {
      abortRef.current?.();
    } catch {}
    setSessionId(null);
    setMessages([]);
    setStreamBuffer("");
    setCandidates(null);
    setSavedFromExtraction([]);
    setSavedIds(new Set());
    setError(null);
    setPendingText("");
    // Refresh the greeting so a user who lingered past a boundary sees the
    // right one on their next Begin. Cheap, deterministic, no I/O.
    setGreeting(getLocalTimeGreeting());
    setPhase("loading"); // avoids a flash of the static greeting on this route
    router.replace("/(tabs)/walk" as any);
  }, [router]);

  return (
    <ScreenBackground>
      <Stack.Screen
        options={{
          headerShown: false,
          // Swipe-back should always work — never held hostage by streaming.
          gestureEnabled: true,
        }}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={handleBackPress}
          hitSlop={12}
          testID="walk-close"
          accessibilityRole="button"
          accessibilityLabel="Back"
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
          {/* Static local-time greeting — pure UI ornament, never touches the
              transcript, backend, or LLM. Rendered ONLY when the conversation
              hasn't started yet (empty transcript, no live stream). Disappears
              the moment the user sends their first message. */}
          {phase === "ready" &&
            messages.length === 0 &&
            streamBuffer.length === 0 && (
              <View style={styles.staticGreeting} testID="walk-static-greeting">
                <Text style={styles.staticGreetingLine}>{greeting}</Text>
                <Text style={styles.staticGreetingPrompt}>
                  What&apos;s on your heart today?
                </Text>
              </View>
            )}
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
              onDone={handleDone}
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
        {phase === "ready" && messages.some((m) => m.role === "user") && (
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

type Voice = "scripture" | "neutral";
type Segment = { voice: Voice; body: string; reference: string | null };

// The only voice-tag we honor is "Scripture says" — that's the technical
// marker the prompt uses so the app can render Scripture as a distinct card.
// Everything else flows as ordinary prose. No "YOU SAID" or "I'M WONDERING"
// labels: those would expose the AI mechanics and are exactly what the
// product wants to avoid.
const SCRIPTURE_MARKER = /(^|\n\s*)Scripture says[,\s—:-]+/i;

// Try to pull "(Book Chapter[:verse[-verse]])" out of a Scripture body so we
// can render the reference cleanly below the quotation. Falls back to null.
const REFERENCE_RE =
  /\(((?:\d\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d{1,3}(?::\d{1,3}(?:[-\u2013]\d{1,3})?)?)\)/;

// Also match a dash-prefixed reference like "— Philippians 4:6-7" or
// "— Philippians 4:6–7 (ESV)".
const REFERENCE_DASH_RE =
  /[\u2014\u2013-]+\s*((?:\d\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d{1,3}(?::\d{1,3}(?:[-\u2013]\d{1,3})?)?)\s*(?:\(ESV\))?\s*$/;

function splitAssistantVoices(content: string): Segment[] {
  // Strip markdown wrappers (bold, italic, block-quote `> `, and stray
  // "Scripture says" bold labels) so the voice detector sees plain prose.
  const cleaned = content
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!_)__(?!_)(.+?)(?<!_)__(?!_)/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")
    // Strip leading '> ' block-quote markers on any line.
    .replace(/(^|\n)>\s?/g, "$1");

  const segments: Segment[] = [];
  let cursor = 0;
  const re = new RegExp(SCRIPTURE_MARKER.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned))) {
    const markerStart = match.index + (match[1]?.length ?? 0);
    if (markerStart > cursor) {
      const pre = cleaned.slice(cursor, markerStart).trim();
      if (pre) segments.push({ voice: "neutral", body: pre, reference: null });
    }
    const afterMarker = match.index + match[0].length;
    const paragraphBreak = cleaned.indexOf("\n\n", afterMarker);
    const lookahead = new RegExp(SCRIPTURE_MARKER.source, "gi");
    lookahead.lastIndex = afterMarker;
    const nextScripture = lookahead.exec(cleaned);
    let end = cleaned.length;
    if (paragraphBreak !== -1 && paragraphBreak < end) end = paragraphBreak;
    if (nextScripture && nextScripture.index < end) end = nextScripture.index;
    const bodyRaw = cleaned.slice(afterMarker, end).trim();
    // Extract the reference in several common shapes:
    //   1) (Book chapter:verse)
    //   2) — Book chapter:verse
    //   3) — Book chapter:verse (ESV)
    // We pick the LAST match (references usually come at the end).
    let bodyClean = bodyRaw;
    let reference: string | null = null;
    const parenMatch = bodyClean.match(REFERENCE_RE);
    const dashMatch = bodyClean.match(REFERENCE_DASH_RE);
    if (dashMatch) {
      reference = dashMatch[1].trim();
      bodyClean = bodyClean.replace(dashMatch[0], "").trim();
    } else if (parenMatch) {
      reference = parenMatch[1].trim();
      bodyClean = bodyClean.replace(parenMatch[0], "").trim();
    }
    // Strip a trailing "(ESV)" / "ESV" note that might be left over.
    bodyClean = bodyClean.replace(/\s*\(ESV\)\s*$/i, "").trim();
    // Strip surrounding quotation marks if the entire body is quoted.
    if (
      (bodyClean.startsWith('"') && bodyClean.endsWith('"')) ||
      (bodyClean.startsWith("\u201c") && bodyClean.endsWith("\u201d"))
    ) {
      bodyClean = bodyClean.slice(1, -1).trim();
    }
    segments.push({
      voice: "scripture",
      body: bodyClean,
      reference,
    });
    cursor = end;
    re.lastIndex = end;
  }
  if (cursor < cleaned.length) {
    const tail = cleaned.slice(cursor).trim();
    if (tail) segments.push({ voice: "neutral", body: tail, reference: null });
  }
  if (segments.length === 0) {
    return [{ voice: "neutral", body: cleaned.trim(), reference: null }];
  }
  return segments;
}

function VoiceSegment({ segment, last }: { segment: Segment; last: boolean }) {
  const { voice, body, reference } = segment;
  if (voice === "scripture") {
    return (
      <View style={styles.scriptureCard} testID="walk-voice-scripture">
        <Text style={styles.scriptureBody}>{body}</Text>
        {reference ? <Text style={styles.scriptureRef}>{reference}</Text> : null}
      </View>
    );
  }
  return (
    <Text style={[styles.assistantText, last && styles.assistantTextPulsing]}>
      {body}
    </Text>
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
          {"Here's the shape of what we sat with. I've kept the meaning of what you shared — you can view or remove any of these anytime from the Walk tab."}
        </Text>
      ) : (
        <Text style={styles.endedBody}>
          {"Anything from today you'd like me to remember for next time?"}
        </Text>
      )}
      {savedFromExtraction.length > 0 && (
        <View style={styles.savedList} testID="walk-saved-from-extraction">
          <Text style={styles.savedListHeader}>Saved to your Walk memory</Text>
          <Text style={styles.savedListHint}>
            You can view or remove these anytime from the Walk tab.
          </Text>
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
  // Static local-time greeting hero. Deliberately quiet — a serif line and a
  // gentle prompt, centered with generous top-padding so the empty state
  // reads as an invitation rather than a broken screen. Once the user sends
  // their first message this block unmounts and normal chat bubbles take
  // over.
  staticGreeting: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: 10,
    alignItems: "flex-start",
  },
  staticGreetingLine: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 32,
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  staticGreetingPrompt: {
    fontFamily: fonts.sansRegular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
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
  scriptureCard: {
    backgroundColor: "rgba(200,169,107,0.06)",
    borderRadius: radii.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginVertical: 6,
    gap: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  scriptureRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 1,
    marginTop: 4,
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
  // Small helper line sitting below "SAVED TO YOUR WALK MEMORY" so users
  // know where these items go and how to manage them later. Not a link —
  // deliberately quiet, we don't want to compete with the Done CTA below.
  savedListHint: {
    fontFamily: fonts.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
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
