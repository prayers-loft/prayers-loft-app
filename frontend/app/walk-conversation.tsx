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

  // Fire /end in the background so a "Leave conversation" tap can navigate
  // instantly while the server still runs extraction. Nothing awaits this.
  // Errors are swallowed silently — the memory the user already confirmed
  // (via typed "I commit to..." statements etc.) is captured server-side
  // during the /end call whether or not the client sticks around.
  const fireEndInBackground = useCallback(() => {
    if (!sessionId) return;
    // Guard: never persist / extract / summarize a session that contains
    // no user turns. The messages array is seeded with one assistant
    // opener at session start (line ~73), so "the user has actually
    // participated" is defined as "at least one message with role='user'".
    //
    // Root cause of Build 26A bug #1: previously we called /end
    // unconditionally on Back. For an empty session the server's
    // summarization LLM produces an empty/fallback string that then
    // overwrites the returning-user's previous session_summary. Result:
    // the Walk landing "Last time, ..." callback disappears after the
    // user opens Walk, sees the greeting, and backs out without typing.
    //
    // Fix: skip /end entirely when there is nothing to extract. No
    // network call, no state overwrite, no risk of clobbering data.
    const hasUserTurn = messages.some((m) => m.role === "user");
    if (!hasUserTurn) return;
    // Abort any live stream first to avoid a race with /end.
    try {
      abortRef.current?.();
    } catch {}
    // Fire-and-forget; we do NOT await this.
    endWalkSession(sessionId).catch(() => {
      /* extraction is best-effort by design */
    });
  }, [sessionId, messages]);

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

type Voice = "scripture" | "neutral";
type Segment = { voice: Voice; body: string; reference: string | null };

// The only voice-tag we honor is "Scripture says" — that's the technical
// marker the prompt uses so the app can render Scripture as a distinct card.
// Everything else flows as ordinary prose. No "YOU SAID" or "I'M WONDERING"
// labels: those would expose the AI mechanics and are exactly what the
// product wants to avoid.
const SCRIPTURE_MARKER = /(^|\n\s*)Scripture says[,\s—:-]+/i;

// -----------------------------------------------------------------------------
// Phase 5 (Build 26B): comprehensive canonical-book reference extraction.
// Matches all 66 canonical books + common abbreviations + numbered books
// (1/2/3 with or without space, Roman numeral variants) + verse ranges
// (hyphen / en-dash / em-dash). Mirrors backend walk_scripture.py so both
// paths agree on what counts as a valid reference. No LLM calls.
// -----------------------------------------------------------------------------
const BOOK_ALIASES: string[] = [
  // Old Testament (longest first per group).
  "Genesis", "Gen", "Gn",
  "Exodus", "Exod", "Exo", "Ex",
  "Leviticus", "Lev", "Lv",
  "Numbers", "Num", "Nm", "Nu",
  "Deuteronomy", "Deut", "Dt",
  "Joshua", "Josh", "Jos",
  "Judges", "Judg", "Jdg", "Jgs",
  "Ruth", "Ru",
  "1 Samuel", "1Samuel", "1 Sam", "1Sam", "1 Sa", "1Sa", "First Samuel", "I Samuel",
  "2 Samuel", "2Samuel", "2 Sam", "2Sam", "2 Sa", "2Sa", "Second Samuel", "II Samuel",
  "1 Kings", "1Kings", "1 Kgs", "1Kgs", "1 Ki", "1Ki", "First Kings", "I Kings",
  "2 Kings", "2Kings", "2 Kgs", "2Kgs", "2 Ki", "2Ki", "Second Kings", "II Kings",
  "1 Chronicles", "1Chronicles", "1 Chr", "1Chr", "1 Ch", "1Ch", "First Chronicles", "I Chronicles",
  "2 Chronicles", "2Chronicles", "2 Chr", "2Chr", "2 Ch", "2Ch", "Second Chronicles", "II Chronicles",
  "Ezra", "Ezr",
  "Nehemiah", "Neh",
  "Esther", "Est",
  "Job", "Jb",
  "Psalms", "Psalm", "Pss", "Psa", "Ps",
  "Proverbs", "Prov", "Prv", "Pr",
  "Ecclesiastes", "Eccles", "Eccl", "Ecc", "Ec", "Qoh",
  "Song of Solomon", "Song of Songs", "Canticles", "Song", "SoS",
  "Isaiah", "Isa", "Is",
  "Jeremiah", "Jer",
  "Lamentations", "Lam",
  "Ezekiel", "Ezek", "Eze", "Ezk", "Ez",
  "Daniel", "Dan", "Dn",
  "Hosea", "Hos",
  "Joel", "Jl",
  "Amos", "Am",
  "Obadiah", "Obad", "Ob",
  "Jonah", "Jon", "Jnh",
  "Micah", "Mic",
  "Nahum", "Nah", "Na",
  "Habakkuk", "Hab", "Hb",
  "Zephaniah", "Zeph", "Zep",
  "Haggai", "Hag", "Hg",
  "Zechariah", "Zech", "Zec",
  "Malachi", "Mal",
  // New Testament
  "Matthew", "Matt", "Mt",
  "Mark", "Mk", "Mrk",
  "Luke", "Lk", "Luk",
  "John", "Jn", "Jhn",
  "Acts", "Ac", "Act",
  "Romans", "Rom", "Ro", "Rm",
  "1 Corinthians", "1Corinthians", "1 Cor", "1Cor", "1 Co", "1Co", "First Corinthians", "I Corinthians",
  "2 Corinthians", "2Corinthians", "2 Cor", "2Cor", "2 Co", "2Co", "Second Corinthians", "II Corinthians",
  "Galatians", "Gal", "Ga",
  "Ephesians", "Eph", "Ephes",
  "Philippians", "Phil", "Php", "Pp",
  "Colossians", "Col", "Cl",
  "1 Thessalonians", "1Thessalonians", "1 Thess", "1Thess", "1 Th", "1Th", "First Thessalonians", "I Thessalonians",
  "2 Thessalonians", "2Thessalonians", "2 Thess", "2Thess", "2 Th", "2Th", "Second Thessalonians", "II Thessalonians",
  "1 Timothy", "1Timothy", "1 Tim", "1Tim", "1 Ti", "1Ti", "First Timothy", "I Timothy",
  "2 Timothy", "2Timothy", "2 Tim", "2Tim", "2 Ti", "2Ti", "Second Timothy", "II Timothy",
  "Titus", "Tit", "Ti",
  "Philemon", "Phlm", "Phm", "Philem",
  "Hebrews", "Heb", "Hb",
  "James", "Jas", "Jm",
  "1 Peter", "1Peter", "1 Pet", "1Pet", "1 Pe", "1Pe", "First Peter", "I Peter",
  "2 Peter", "2Peter", "2 Pet", "2Pet", "2 Pe", "2Pe", "Second Peter", "II Peter",
  "1 John", "1John", "1 Jn", "1Jn", "1 Jo", "1Jo", "First John", "I John",
  "2 John", "2John", "2 Jn", "2Jn", "2 Jo", "2Jo", "Second John", "II John",
  "3 John", "3John", "3 Jn", "3Jn", "3 Jo", "3Jo", "Third John", "III John",
  "Jude", "Jud",
  "Revelation", "Rev", "Rv", "Apocalypse",
];

// Longest-first so "Song of Solomon" wins over "Song", "1 Corinthians" over "1 Cor".
const _sortedAliases = [...new Set(BOOK_ALIASES)].sort(
  (a, b) => b.length - a.length,
);
const _bookAlt = _sortedAliases
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

// Full reference regex — book (+ optional trailing dot) + \s+ + chapter [+ :verse [-verse]].
// Rejects letter/digit immediately following to prevent "Genesis 1:1a" or "5:301".
const SCRIPTURE_REFERENCE_RE = new RegExp(
  `(?<![A-Za-z])(${_bookAlt})\\.?\\s+(\\d{1,3})(?:[:\\.](\\d{1,3})(?:[-\u2013\u2014](\\d{1,3}))?)?(?![A-Za-z0-9])`,
);
// Global variant reserved for future bare-reference inline highlighting.
// Not consumed yet — Phase 5 keeps card rendering behind the "Scripture
// says" marker for backward compatibility.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SCRIPTURE_REFERENCE_RE_G = new RegExp(SCRIPTURE_REFERENCE_RE.source, "g");

// Reference extraction inside Scripture-says bodies — parenthesized form.
// e.g. "...(Philippians 4:6-7)" or "(1 Peter 5:7)".
const REFERENCE_RE = new RegExp(
  `\\((${_bookAlt})\\.?\\s+(\\d{1,3})(?:[:\\.](\\d{1,3})(?:[-\u2013\u2014](\\d{1,3}))?)?\\s*(?:\\(ESV\\))?\\)`,
);

// Dash-prefixed trailing reference: "— Philippians 4:6-7 (ESV)".
const REFERENCE_DASH_RE = new RegExp(
  `[\u2014\u2013\\-]+\\s*(${_bookAlt})\\.?\\s+(\\d{1,3})(?:[:\\.](\\d{1,3})(?:[-\u2013\u2014](\\d{1,3}))?)?\\s*(?:\\(ESV\\))?\\s*$`,
);

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
    // Phase 5: the reference regexes now capture groups (book, chap, vs, ve)
    // instead of a single reference string — build the display string from
    // the pieces so numbered/abbreviated books render cleanly.
    let bodyClean = bodyRaw;
    let reference: string | null = null;
    const parenMatch = bodyClean.match(REFERENCE_RE);
    const dashMatch = bodyClean.match(REFERENCE_DASH_RE);
    const buildRef = (m: RegExpMatchArray): string => {
      const book = m[1];
      const chap = m[2];
      const vs = m[3];
      const ve = m[4];
      let out = `${book} ${chap}`;
      if (vs) out += `:${vs}`;
      if (ve) out += `-${ve}`;
      return out;
    };
    if (dashMatch) {
      reference = buildRef(dashMatch);
      bodyClean = bodyClean.replace(dashMatch[0], "").trim();
    } else if (parenMatch) {
      reference = buildRef(parenMatch);
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
          {"Here's the shape of what we sat with. I've kept the meaning of what you shared — you can remove any of these later from Walk."}
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
