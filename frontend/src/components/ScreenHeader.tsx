// Top-of-screen header. Wordmark left, single Profile entry-point right.
//
// Design intent: the Profile circle is the *only* top-right action. It opens
// the unified Profile + Settings screen where every account, preference,
// data, privacy, and about action lives. No more speaker icon, no more gold
// dot \u2014 clean, premium, purposeful.
import { useRef } from "react";
import { Animated, StyleSheet, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { colors, fonts } from "@/src/theme/theme";

export function ScreenHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.92, friction: 8, useNativeDriver: true }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }).start();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
      <Text style={styles.brandText} accessibilityRole="header">Prayers Loft</Text>

      <Pressable
        onPress={() => router.push("/settings")}
        onPressIn={pressIn}
        onPressOut={pressOut}
        hitSlop={10}
        // Test-id name kept stable so the existing E2E suite still binds.
        testID="settings-icon-button"
        accessibilityRole="button"
        accessibilityLabel="Profile and settings"
      >
        <Animated.View style={[styles.avatarWrap, { transform: [{ scale }] }]}>
          <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={styles.avatarOverlay} />
          <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const AVATAR_SIZE = 36;

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandText: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.22)", // subtle warm-sand accent ring
  },
  // Subtle inner glass tint that sits over the BlurView for warmth.
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
});
