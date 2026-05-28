// Prayer Assistant. Premium, minimal, conversational.
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, fonts } from "@/src/theme/theme";
import { api, parsePrayerReflection, PrayerReflection } from "@/src/lib/api";
import { addSavedPrayer } from "@/src/lib/local-store";

type Stage = "idle" | "reflection" | "prayer";

export default function PrayerScreen() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [loading, setLoading] = useState(false);
  const [reflection, setReflection] = useState<PrayerReflection | null>(null);
  const [prayer, setPrayer] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const [showAmen, setShowAmen] = useState(false);

  const amenOpacity = useRef(new Animated.Value(0)).current;
  const amenScale = useRef(new Animated.Value(0.85)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const reflectionFade = useRef(new Animated.Value(0)).current;
  const prayerFade = useRef(new Animated.Value(0)).current;
  const prefetchedRef = useRef<{ key: string; promise: Promise<string> } | null>(null);

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  }, [fadeIn]);

  const fadeInElement = (anim: Animated.Value) => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  };

  const startPrefetch = (msg: string) => {
    if (prefetchedRef.current?.key === msg) return;
    prefetchedRef.current = {
      key: msg,
      promise: api.prayerFollowUp(msg).then((r) => r.prayer).catch(() => ""),
    };
  };

  const submitReflection = async () => {
    if (!message.trim() || loading) return;
    setLoading(true);
    setReflection(null);
    setPrayer("");
    setSaved(false);
    prefetchedRef.current = null;
    const msg = message.trim();
    try {
      const res = await api.prayerRequest(msg);
      setReflection(parsePrayerReflection(res.response));
      setStage("reflection");
      fadeInElement(reflectionFade);
      startPrefetch(msg);
    } catch (e) {
      console.warn("prayer request failed", e);
    } finally {
      setLoading(false);
    }
  };

  const submitPrayer = async () => {
    if (loading) return;
    setLoading(true);
    const msg = message.trim();
    if (!prefetchedRef.current || prefetchedRef.current.key !== msg) startPrefetch(msg);
    try {
      const result = await prefetchedRef.current!.promise;
      const finalPrayer = result || (await api.prayerFollowUp(msg)).prayer;
      setPrayer(finalPrayer);
      setStage("prayer");
      fadeInElement(prayerFade);
      // Amen overlay
      setShowAmen(true);
      amenOpacity.setValue(0);
      amenScale.setValue(0.85);
      Animated.parallel([
        Animated.timing(amenOpacity, { toValue: 1, duration: 500, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.spring(amenScale, { toValue: 1, useNativeDriver: true, friction: 7 }),
      ]).start(() => {
        setTimeout(() => {
          Animated.timing(amenOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => setShowAmen(false));
        }, 1600);
      });
    } catch (e) {
      console.warn("prayer follow-up failed", e);
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = () => {
    setMessage("");
    setReflection(null);
    setPrayer("");
    setSaved(false);
    setStage("idle");
    prefetchedRef.current = null;
  };

  const handleSave = async () => {
    if (!reflection || !prayer) return;
    const id = Crypto.randomUUID();
    await addSavedPrayer({
      id,
      request: message.trim(),
      reflection: [reflection.empathy, reflection.characterReflection].filter(Boolean).join("\n\n"),
      prayer,
      verseReference: reflection.verseReference,
      bibleLink: reflection.bibleLink,
      created_at: new Date().toISOString(),
    });
    setSaved(true);
  };

  const handleShare = async () => {
    if (!prayer) return;
    const verseLine = reflection?.verseReference ? `\n${reflection.verseReference}\n` : "\n";
    const text = `A Prayer For You\n\n${prayer}${verseLine}\nfrom Prayers Loft`;
    try {
      await Share.share({ message: text, title: "A Prayer For You" });
    } catch {
      try { await Clipboard.setStringAsync(text); } catch {}
    }
  };

  const openVerse = () => {
    if (reflection?.bibleLink) Linking.openURL(reflection.bibleLink);
  };

  return (
    <ScreenBackground>
      <ScreenHeader />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={32}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeIn }}>
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>Prayer</Text>
            <Text style={styles.title}>Take a breath.</Text>
            <Text style={styles.subtitle}>You don't need perfect words.</Text>
          </View>

          {/* Journal-style input */}
          <View style={styles.inputWrap}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder="What's resting on your heart tonight?"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="prayer-input"
              editable={!loading}
            />
          </View>

          {stage !== "reflection" && (
            <PrimaryButton
              onPress={submitReflection}
              disabled={!message.trim() || loading}
              loading={loading}
              label={loading ? "Listening" : stage === "prayer" ? "Begin a new prayer" : "Begin"}
              testID="begin-prayer-button"
            />
          )}
        </Animated.View>

        {reflection && (
          <Animated.View style={[styles.reflectionCard, { opacity: reflectionFade }]} testID="reflection-card">
            {!!reflection.empathy && <Text style={styles.reflectionText}>{reflection.empathy}</Text>}
            {!!reflection.characterReflection && (
              <Text style={[styles.reflectionText, styles.reflectionTextMuted]}>
                {reflection.characterReflection}
              </Text>
            )}
            {!!reflection.verseText && (
              <View style={styles.verseBlock}>
                <Text style={styles.verseText}>"{reflection.verseText}"</Text>
                <Pressable onPress={openVerse} testID="verse-link" style={styles.verseRefRow}>
                  <Text style={styles.verseRef}>{reflection.verseReference}</Text>
                  <Ionicons name="open-outline" size={12} color={colors.accent} />
                </Pressable>
              </View>
            )}
            {stage === "reflection" && (
              <View style={{ marginTop: 14 }}>
                <Text style={styles.closingQ}>{reflection.closingQuestion}</Text>
                <PrimaryButton
                  onPress={submitPrayer}
                  disabled={loading}
                  loading={loading}
                  label={loading ? "Praying with you" : "Pray with me"}
                  testID="pray-with-me-button"
                />
              </View>
            )}
          </Animated.View>
        )}

        {stage === "prayer" && !!prayer && (
          <Animated.View style={[styles.prayerCard, { opacity: prayerFade }]} testID="prayer-card">
            <Text style={styles.prayerLabel}>A prayer for you</Text>
            <View style={{ gap: 8 }}>
              {prayer.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => (
                <Text key={i} style={styles.prayerLine}>{line}</Text>
              ))}
            </View>
            <View style={styles.actionsRow}>
              <IconAction icon={saved ? "checkmark" : "bookmark-outline"} label={saved ? "Saved" : "Save"} onPress={handleSave} disabled={saved} testID="save-prayer-button" />
              <IconAction icon="share-outline" label="Share" onPress={handleShare} testID="share-prayer-button" />
            </View>
            <Pressable onPress={() => router.push("/(tabs)/reflections")} style={styles.sitWithLink} testID="want-to-sit-with-this-button">
              <Text style={styles.sitWithText}>Want to sit with this?</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent} />
            </Pressable>
            <Pressable onPress={handleStartOver} style={styles.startOver} testID="start-over-button">
              <Ionicons name="add" size={16} color={colors.accent} />
              <Text style={styles.startOverText}>Pray about something else</Text>
            </Pressable>
          </Animated.View>
        )}
      </KeyboardAwareScrollView>

      {showAmen && (
        <Animated.View style={[styles.amenOverlay, { opacity: amenOpacity, pointerEvents: "none" }]} testID="amen-overlay">
          <Animated.Text style={[styles.amenText, { transform: [{ scale: amenScale }] }]}>Amen</Animated.Text>
        </Animated.View>
      )}
    </ScreenBackground>
  );
}

function PrimaryButton({ onPress, label, disabled, loading, testID }: { onPress: () => void; label: string; disabled?: boolean; loading?: boolean; testID?: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, friction: 8 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start()}
      testID={testID}
    >
      <Animated.View style={[styles.primaryBtn, (disabled || loading) && styles.primaryBtnDisabled, { transform: [{ scale }] }]}>
        {loading ? <ActivityIndicator color={colors.textOnAccent} size="small" /> : <Text style={styles.primaryBtnText}>{label}</Text>}
      </Animated.View>
    </Pressable>
  );
}

function IconAction({ icon, label, onPress, disabled, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.iconAction, pressed && { opacity: 0.6 }]} testID={testID}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={styles.iconActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 160, gap: 22 },
  hero: { marginTop: 18, marginBottom: 22 },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.accent, letterSpacing: 2.4, textTransform: "uppercase", marginBottom: 16 },
  title: { fontFamily: fonts.sansSemibold, fontSize: 32, color: colors.text, letterSpacing: -0.6, lineHeight: 40 },
  subtitle: { fontFamily: fonts.sans, fontSize: 15, color: colors.textSecondary, marginTop: 10, lineHeight: 23 },
  inputWrap: {
    backgroundColor: colors.surface2,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 20,
    minHeight: 150,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 25,
    minHeight: 110,
    textAlignVertical: "top",
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: colors.accent, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 3 },
      default: { boxShadow: "0 6px 18px rgba(212,179,106,0.18)" } as any,
    }),
  },
  primaryBtnDisabled: { opacity: 0.35 },
  primaryBtnText: { fontFamily: fonts.sansSemibold, color: colors.textOnAccent, fontSize: 15, letterSpacing: 0.2 },
  reflectionCard: {
    backgroundColor: colors.surface1,
    borderRadius: 24,
    padding: 24,
    gap: 14,
  },
  reflectionText: { fontFamily: fonts.serif, color: colors.text, fontSize: 17, lineHeight: 26 },
  reflectionTextMuted: { color: colors.textSecondary },
  verseBlock: {
    paddingLeft: 14,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    marginTop: 4,
    gap: 6,
  },
  verseText: { fontFamily: fonts.serifItalic, fontStyle: "italic", fontSize: 16, color: colors.text, lineHeight: 24 },
  verseRefRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  verseRef: { fontFamily: fonts.sansSemibold, fontSize: 12, color: colors.accent, letterSpacing: 0.3 },
  closingQ: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 14, marginBottom: 14, lineHeight: 21 },
  prayerCard: {
    backgroundColor: colors.surface1,
    borderRadius: 24,
    padding: 26,
    gap: 14,
  },
  prayerLabel: { fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 2.2, color: colors.accent, textTransform: "uppercase", marginBottom: 4 },
  prayerLine: { fontFamily: fonts.serifItalic, fontStyle: "italic", color: colors.text, fontSize: 18, lineHeight: 28 },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  iconAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: colors.surface2,
    borderRadius: 14,
  },
  iconActionText: { fontFamily: fonts.sansMedium, color: colors.accent, fontSize: 13 },
  sitWithLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  sitWithText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.accent },
  startOver: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: colors.accentSoft,
  },
  startOverText: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.accent, letterSpacing: 0.2 },
  amenOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,16,32,0.6)",
  },
  amenText: {
    fontFamily: fonts.sansBold,
    fontSize: 56,
    color: colors.accent,
    letterSpacing: 1,
  },
});
