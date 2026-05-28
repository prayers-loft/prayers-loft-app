// Prayer Assistant tab — scripture-first prayer flow.
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  Easing,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { PrayerImageCard, PRAYER_CARD_WIDTH, PRAYER_CARD_HEIGHT } from "@/src/components/PrayerImageCard";
import { colors, fonts } from "@/src/theme/theme";
import { api, parsePrayerReflection, PrayerReflection } from "@/src/lib/api";
import { addSavedPrayer } from "@/src/lib/local-store";
import * as Crypto from "expo-crypto";

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
  const shareCardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);

  const submitReflection = async () => {
    if (!message.trim() || loading) return;
    setLoading(true);
    // Clear any prior reflection/prayer and prefetch so this feels like a fresh start.
    setReflection(null);
    setPrayer("");
    setSaved(false);
    prefetchedPrayerRef.current = null;
    const msg = message.trim();
    try {
      const res = await api.prayerRequest(msg);
      const parsed = parsePrayerReflection(res.response);
      setReflection(parsed);
      setStage("reflection");
      // Kick off the prayer follow-up in the background while the user reads.
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
    // If we don't already have a prefetch for this exact message, start one now.
    if (!prefetchedPrayerRef.current || prefetchedPrayerRef.current.key !== msg) {
      startPrefetch(msg);
    }
    const inflight = prefetchedPrayerRef.current!.promise;
    try {
      const result = await inflight;
      // If prefetch failed (empty), retry once directly.
      const finalPrayer = result || (await api.prayerFollowUp(msg)).prayer;
      setPrayer(finalPrayer);
      setStage("prayer");
      // Trigger Amen animation
      setShowAmen(true);
      amenOpacity.setValue(0);
      amenScale.setValue(0.85);
      Animated.parallel([
        Animated.timing(amenOpacity, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.spring(amenScale, { toValue: 1, useNativeDriver: true, friction: 6 }),
      ]).start(() => {
        setTimeout(() => {
          Animated.timing(amenOpacity, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => setShowAmen(false));
        }, 1800);
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
    prefetchedPrayerRef.current = null;
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
    if (!prayer || sharing) return;
    const verseLine = reflection?.verseReference ? `\n${reflection.verseReference}\n` : "\n";
    const text = `A Prayer For You\n\n${prayer}${verseLine}\nfrom Prayers Loft`;
    setSharing(true);
    try {
      await Share.share({ message: text, title: "A Prayer For You" });
    } catch (e) {
      console.warn("share failed", e);
      try {
        await Clipboard.setStringAsync(text);
      } catch {
        // ignore
      }
    } finally {
      setSharing(false);
    }
  };

  const handleShareImage = async () => {
    if (!prayer || sharingImage) return;
    setSharingImage(true);
    try {
      await new Promise((r) => setTimeout(r, 80));
      const uri = await captureRef(shareCardRef, {
        format: "png",
        quality: 1,
        result: Platform.OS === "web" ? "data-uri" : "tmpfile",
        width: PRAYER_CARD_WIDTH,
        height: PRAYER_CARD_HEIGHT,
      });
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = uri;
        a.download = "prayers-loft.png";
        a.click();
        return;
      }
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "A Prayer For You",
          UTI: "public.png",
        });
      }
    } catch (e) {
      console.warn("share image failed", e);
    } finally {
      setSharingImage(false);
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
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Prayer Assistant</Text>
        <Text style={styles.title}>What's on your heart?</Text>
        <Text style={styles.subtitle}>
          Share a prayer request, a feeling, or simply where you are right now.
        </Text>

        <View style={styles.inputCard}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder="I've been feeling…"
            placeholderTextColor="rgba(250,248,243,0.35)"
            style={styles.input}
            testID="prayer-input"
            editable={!loading}
          />
        </View>

        {stage !== "reflection" && (
          <PrimaryButton
            onPress={submitReflection}
            disabled={!message.trim() || loading}
            label={loading ? "Listening…" : stage === "prayer" ? "Begin a New Prayer" : "Begin"}
            loading={loading}
            testID="begin-prayer-button"
          />
        )}

        {reflection && (
          <View style={styles.reflectionCard} testID="reflection-card">
            {!!reflection.empathy && <Text style={styles.reflectionText}>{reflection.empathy}</Text>}
            {!!reflection.characterReflection && (
              <Text style={[styles.reflectionText, styles.reflectionTextSpaced]}>
                {reflection.characterReflection}
              </Text>
            )}
            {!!reflection.verseText && (
              <View style={styles.verseBlock}>
                <Text style={styles.verseText}>"{reflection.verseText}"</Text>
                <Pressable onPress={openVerse} testID="verse-link">
                  <Text style={styles.verseRef}>{reflection.verseReference}  ↗</Text>
                </Pressable>
              </View>
            )}
            {stage === "reflection" && (
              <>
                <Text style={styles.closingQ}>{reflection.closingQuestion}</Text>
                <PrimaryButton
                  onPress={submitPrayer}
                  disabled={loading}
                  label={loading ? "Praying with you…" : "Yes, Pray With Me 🙏"}
                  loading={loading}
                  testID="pray-with-me-button"
                />
              </>
            )}
          </View>
        )}

        {stage === "prayer" && !!prayer && (
          <View style={styles.prayerCard} testID="prayer-card">
            <Text style={styles.prayerLabel}>A prayer for you</Text>
            {prayer.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => (
              <Text key={i} style={styles.prayerLine}>{line}</Text>
            ))}
            <View style={styles.actionsRow}>
              <SecondaryButton
                onPress={handleSave}
                label={saved ? "Saved ✓" : "Save 💾"}
                disabled={saved}
                testID="save-prayer-button"
              />
              <SecondaryButton
                onPress={handleShare}
                label={sharing ? "…" : "Share ↗"}
                disabled={sharing}
                testID="share-prayer-button"
              />
              <SecondaryButton
                onPress={handleShareImage}
                label={sharingImage ? "…" : "Image 🖼️"}
                disabled={sharingImage}
                testID="share-image-button"
              />
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/reflections")}
              style={styles.sitWithLink}
              testID="want-to-sit-with-this-button"
            >
              <Text style={styles.sitWithText}>Want to sit with this? Open Reflections →</Text>
            </Pressable>
            <Pressable onPress={handleStartOver} style={styles.startOver} testID="start-over-button">
              <Text style={styles.startOverText}>+  Pray About Something Else</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollView>

      {showAmen && (
        <Animated.View
          style={[styles.amenOverlay, { opacity: amenOpacity, pointerEvents: "none" }]}
          testID="amen-overlay"
        >
          <Animated.Text style={[styles.amenText, { transform: [{ scale: amenScale }] }]}>
            Amen
          </Animated.Text>
        </Animated.View>
      )}

      {/* Off-screen shareable image card. Captured by react-native-view-shot when user taps "Image". */}
      {!!prayer && (
        <View style={styles.offscreen} pointerEvents="none">
          <PrayerImageCard ref={shareCardRef} prayer={prayer} verseReference={reflection?.verseReference} />
        </View>
      )}
    </ScreenBackground>
  );
}

function PrimaryButton({ onPress, label, disabled, loading, testID }: { onPress: () => void; label: string; disabled?: boolean; loading?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={colors.bgTop} />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

function SecondaryButton({ onPress, label, disabled, testID }: { onPress: () => void; label: string; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.secondaryBtn, disabled && styles.secondaryBtnDisabled]}
      testID={testID}
    >
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingBottom: 64, gap: 16 },
  eyebrow: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginTop: 8 },
  title: { fontFamily: fonts.sansBold, fontSize: 28, color: colors.ivory, lineHeight: 34, marginTop: 6, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.sans, fontSize: 15, color: colors.textSecondary, lineHeight: 22, marginBottom: 8 },
  inputCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    minHeight: 130,
  },
  input: {
    flex: 1,
    color: colors.ivory,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 100,
    textAlignVertical: "top",
  },
  primaryBtn: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnDisabled: { opacity: 0.35 },
  primaryBtnText: { fontFamily: fonts.sansBold, color: colors.bgTop, fontSize: 15, letterSpacing: 0.3 },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.5)",
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "rgba(201,168,76,0.05)",
  },
  secondaryBtnDisabled: { opacity: 0.5 },
  secondaryBtnText: { fontFamily: fonts.sansSemibold, color: colors.gold, fontSize: 13 },
  reflectionCard: {
    backgroundColor: colors.ivory,
    borderRadius: 20,
    padding: 22,
    gap: 12,
    marginTop: 4,
  },
  reflectionText: { fontFamily: fonts.serif, color: colors.onCard, fontSize: 17, lineHeight: 26 },
  reflectionTextSpaced: { color: "rgba(10,14,26,0.85)" },
  verseBlock: {
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    paddingLeft: 14,
    marginVertical: 4,
    gap: 4,
  },
  verseText: { fontFamily: fonts.serifItalic, fontSize: 16, color: colors.onCard, lineHeight: 24, fontStyle: "italic" },
  verseRef: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.gold, marginTop: 4 },
  closingQ: { fontFamily: fonts.sansMedium, color: colors.onCard, fontSize: 15, marginTop: 4 },
  prayerCard: {
    backgroundColor: colors.ivory,
    borderRadius: 20,
    padding: 24,
    gap: 8,
    marginTop: 2,
  },
  prayerLabel: { fontFamily: fonts.sansSemibold, fontSize: 11, letterSpacing: 2.5, color: colors.gold, textTransform: "uppercase", marginBottom: 6 },
  prayerLine: { fontFamily: fonts.serifItalic, fontStyle: "italic", color: colors.onCard, fontSize: 18, lineHeight: 28 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  sitWithLink: { marginTop: 12 },
  sitWithText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.gold },
  startOver: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.45)",
    alignItems: "center",
    backgroundColor: "rgba(201,168,76,0.06)",
  },
  startOverText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.goldHover,
    letterSpacing: 0.3,
  },
  amenOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,14,26,0.55)",
  },
  amenText: {
    fontFamily: fonts.sansBold,
    fontSize: 56,
    color: colors.gold,
    letterSpacing: 1,
  },
  offscreen: {
    position: "absolute",
    left: -10000,
    top: 0,
    opacity: 1,
  },
});
