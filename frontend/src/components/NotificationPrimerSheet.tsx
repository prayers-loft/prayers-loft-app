// -----------------------------------------------------------------------------
// NotificationPrimerSheet — the "explain why before we ask" bottom sheet.
//
// Product rationale (Build 16):
// -----------------------------
// Cold-launching straight into the iOS notification prompt is jarring and
// results in high denial rates. Before the OS dialog appears, we show a
// short, benefit-first explanation so the user opts IN to the OS prompt
// with intent. On "Continue" we invoke ensurePermission() and let the OS
// take over; on "Not now" we cleanly bail without denying anything at the
// OS level (so the user can enable later without a trip to Settings.app).
//
// This component is presentation-only. All permission + scheduling logic
// lives in src/lib/reminders.ts. Callers pass onContinue / onCancel and
// decide what to do with the result.
// -----------------------------------------------------------------------------
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { BlurView } from "expo-blur";

export type PrimerBullet = { icon: string; text: string };

// Default bullets tuned for the daily-verse reminder. The caller can
// override for future reminder kinds (prayer, streak-at-risk) without
// touching this component.
export const DEFAULT_PRIMER_BULLETS: PrimerBullet[] = [
  { icon: "✧", text: "A single gentle nudge each day at your chosen time" },
  { icon: "✦", text: "A rotating verse and a moment to reflect" },
  { icon: "◈", text: "Silent by default — never an alarm" },
  { icon: "◇", text: "Turn it off anytime in Settings" },
];

type Props = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  bullets?: PrimerBullet[];
  continueLabel?: string;
  cancelLabel?: string;
  onContinue: () => void;
  onCancel: () => void;
};

export function NotificationPrimerSheet({
  visible,
  title = "Stay grounded, gently",
  subtitle = "Let Prayers Loft nudge you toward your daily verse and reflection — never louder than a whisper.",
  bullets = DEFAULT_PRIMER_BULLETS,
  continueLabel = "Continue",
  cancelLabel = "Not now",
  onContinue,
  onCancel,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        style={styles.scrim}
        onPress={onCancel}
        accessibilityLabel="Close"
        testID="notif-primer-scrim"
      >
        {/* Consume touches so tapping inside the sheet doesn't dismiss. */}
        <Pressable style={styles.sheetWrap} onPress={() => {}}>
          <BlurView
            intensity={Platform.OS === "ios" ? 30 : 0}
            tint="dark"
            style={styles.sheet}
          >
            <View style={styles.leafBadge}>
              <Text style={styles.leafGlyph}>❦</Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            <View style={styles.bullets}>
              {bullets.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bulletIcon}>{b.icon}</Text>
                  <Text style={styles.bulletText}>{b.text}</Text>
                </View>
              ))}
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  pressed && styles.btnPressed,
                ]}
                accessibilityRole="button"
                testID="notif-primer-cancel"
              >
                <Text style={styles.btnGhostText}>{cancelLabel}</Text>
              </Pressable>
              <Pressable
                onPress={onContinue}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPrimary,
                  pressed && styles.btnPressed,
                ]}
                accessibilityRole="button"
                testID="notif-primer-continue"
              >
                <Text style={styles.btnPrimaryText}>{continueLabel}</Text>
              </Pressable>
            </View>
          </BlurView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(4, 6, 12, 0.62)",
    justifyContent: "flex-end",
  },
  sheetWrap: {
    padding: 12,
    paddingBottom: Platform.OS === "ios" ? 32 : 20,
  },
  sheet: {
    borderRadius: 24,
    overflow: "hidden",
    // Dark navy base so BlurView tint composites correctly on Android
    // where BlurView is a no-op.
    backgroundColor: "rgba(10, 14, 26, 0.94)",
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(200, 169, 107, 0.28)",
  },
  leafBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(200, 169, 107, 0.5)",
    backgroundColor: "rgba(200, 169, 107, 0.10)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  leafGlyph: { color: "#C8A96B", fontSize: 22 },
  title: {
    color: "#F4EDDC",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "rgba(244, 237, 220, 0.72)",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  bullets: { marginBottom: 24 },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  bulletIcon: {
    color: "#C8A96B",
    fontSize: 14,
    lineHeight: 22,
    width: 22,
    textAlign: "center",
    marginRight: 8,
  },
  bulletText: {
    color: "rgba(244, 237, 220, 0.88)",
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  actions: { flexDirection: "row", gap: 12 },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(244, 237, 220, 0.22)",
  },
  btnGhostText: {
    color: "rgba(244, 237, 220, 0.82)",
    fontSize: 15,
    fontWeight: "500",
  },
  btnPrimary: { backgroundColor: "#C8A96B" },
  btnPrimaryText: { color: "#0a0e1a", fontSize: 15, fontWeight: "600" },
  btnPressed: { opacity: 0.85 },
});
