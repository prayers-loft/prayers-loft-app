// One-shot AI disclosure modal. Shown on first prayer generation only.
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  Linking,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";

export function AIDisclosureModal({
  visible,
  onContinue,
}: {
  visible: boolean;
  onContinue: () => void;
}) {
  const router = useRouter();

  function openLearnMore() {
    onContinue();
    // give the modal a tick to dismiss before navigating
    setTimeout(() => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        router.push("/privacy" as any);
      } else {
        router.push("/privacy" as any);
      }
    }, 120);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onContinue}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card} testID="ai-disclosure-modal">
          <View style={styles.iconRing}>
            <Ionicons name="sparkles-outline" size={22} color={colors.accent} />
          </View>
          <Text style={styles.title} testID="ai-disclosure-title">
            How prayers are made here
          </Text>
          <Text style={styles.body}>
            Prayers Loft uses AI to help you find words for prayer, reflection, and Scripture exploration.
          </Text>
          <Text style={styles.bodyEm}>
            You are always in control of what you pray and believe.
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={openLearnMore}
              style={[styles.btn, styles.secondaryBtn]}
              testID="ai-disclosure-learn-more"
              accessibilityRole="link"
            >
              <Text style={styles.secondaryText}>Learn More</Text>
            </Pressable>
            <Pressable
              onPress={onContinue}
              style={[styles.btn, styles.primaryBtn]}
              testID="ai-disclosure-continue"
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5,7,18,0.92)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#161E36",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.28)",
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
  iconRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(200,169,107,0.10)",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.32)",
    marginBottom: 14,
  },
  title: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    marginBottom: 10,
  },
  body: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  bodyEm: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  primaryBtn: { backgroundColor: colors.accent },
  secondaryText: { fontFamily: fonts.sansSemibold, color: colors.text, fontSize: 14.5 },
  primaryText: { fontFamily: fonts.sansSemibold, color: "#0c1024", fontSize: 14.5 },
});
