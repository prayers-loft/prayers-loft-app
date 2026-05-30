// Reusable upgrade-prompt bottom sheet.
// One component, three copy variants, driven by `UpgradeTrigger`.
import { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";
import {
  openAuthSheet,
  recordCtaTapped,
  recordDismissed,
  recordShown,
  UpgradeTrigger,
  variantForTrigger,
} from "@/src/lib/upgrade-prompts";

export function UpgradePromptSheet({
  visible,
  trigger,
  onClose,
}: {
  visible: boolean;
  trigger: UpgradeTrigger | null;
  onClose: () => void;
}) {
  const slide = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && trigger) {
      recordShown(trigger).catch(() => {});
      slide.setValue(40);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true }),
        Animated.timing(slide, { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, trigger, fade, slide]);

  if (!trigger) return null;
  const v = variantForTrigger(trigger);

  const dismiss = async () => {
    if (trigger) await recordDismissed(trigger);
    onClose();
  };

  const tapCta = async () => {
    if (trigger) await recordCtaTapped(trigger);
    onClose();
    // Hand off to Phase 2 auth sheet (placeholder for now).
    setTimeout(() => openAuthSheet(trigger!), 220);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable style={styles.backdrop} onPress={dismiss} testID="upgrade-prompt-backdrop" />
      <View style={[styles.sheetWrap, { pointerEvents: "box-none" }]}>
        <Animated.View
          style={[
            styles.sheet,
            { opacity: fade, transform: [{ translateY: slide }] },
          ]}
          testID="upgrade-prompt-sheet"
        >
          <View style={styles.handle} />
          <View style={styles.iconRing}>
            <Ionicons name="sparkles-outline" size={22} color={colors.accent} />
          </View>
          <Text style={styles.title} testID="upgrade-prompt-title">{v.title}</Text>
          <Text style={styles.body}>{v.body}</Text>

          <Pressable
            onPress={tapCta}
            style={styles.primaryBtn}
            testID="upgrade-prompt-cta"
          >
            <Text style={styles.primaryBtnText}>{v.ctaLabel}</Text>
          </Pressable>
          <Pressable
            onPress={dismiss}
            hitSlop={8}
            style={styles.dismissBtn}
            testID="upgrade-prompt-dismiss"
          >
            <Text style={styles.dismissText}>{v.dismissLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(7,12,28,0.7)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 12,
    alignItems: "center",
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  handle: {
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: "rgba(248,250,252,0.18)",
    marginBottom: 6,
  },
  iconRing: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(200,169,107,0.3)",
    backgroundColor: "rgba(255,255,255,0.04)",
    marginTop: 4,
  },
  title: {
    fontFamily: fonts.sansSemibold, color: colors.text,
    fontSize: 20, letterSpacing: -0.2, textAlign: "center", marginTop: 6,
  },
  body: {
    fontFamily: fonts.sans, color: colors.textSecondary,
    fontSize: 14, lineHeight: 21, textAlign: "center",
    paddingHorizontal: 8, marginBottom: 6,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14, paddingHorizontal: 18, borderRadius: 14,
    alignSelf: "stretch", alignItems: "center", marginTop: 4,
  },
  primaryBtnText: { fontFamily: fonts.sansSemibold, color: colors.textOnAccent, fontSize: 14.5 },
  dismissBtn: { paddingVertical: 12 },
  dismissText: { fontFamily: fonts.sansMedium, color: colors.textTertiary, fontSize: 13.5 },
});
