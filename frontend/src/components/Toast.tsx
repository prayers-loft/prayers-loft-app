// Lightweight in-app toast/banner system.
// Slides down from the top with a Reanimated-free Animated API (cross-platform
// safe). Auto-dismisses after `duration` (default 3.5s). One-toast-at-a-time;
// new toasts replace any visible one.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  DeviceEventEmitter,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "@/src/theme/theme";

export type ToastVariant = "success" | "info" | "error";

export type ToastPayload = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  duration?: number; // ms
};

const EVT = "prayersloft:show-toast";

export function showToast(payload: ToastPayload): void {
  DeviceEventEmitter.emit(EVT, payload);
}

const VARIANT_ICON: Record<ToastVariant, keyof typeof Ionicons.glyphMap> = {
  success: "checkmark-circle",
  info: "information-circle",
  error: "alert-circle",
};

const VARIANT_ACCENT: Record<ToastVariant, string> = {
  success: colors.accent, // warm sand gold
  info: "#9DB5DA",
  error: "#FCA5A5",
};

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-24)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(translateY, {
        toValue: -24,
        duration: 240,
        easing: Easing.in(Easing.quad),
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [opacity, translateY]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT, (payload: ToastPayload) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast(payload);
      // animate in
      opacity.setValue(0);
      translateY.setValue(-24);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.spring(translateY, {
          toValue: 0,
          tension: 70,
          friction: 11,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]).start();
      const ms = payload.duration ?? 3800;
      hideTimer.current = setTimeout(() => dismiss(), ms);
    });
    return () => {
      sub.remove();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [opacity, translateY, dismiss]);

  if (!toast) return null;
  const variant = toast.variant || "success";
  const accent = VARIANT_ACCENT[variant];
  const top = (insets.top || 12) + 8;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top, opacity, transform: [{ translateY }] }]}
      testID="app-toast"
    >
      <Pressable
        onPress={dismiss}
        style={styles.card}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={`app-toast-${variant}`}
      >
        <View style={[styles.iconRing, { borderColor: accent, backgroundColor: `${accent}1F` }]}>
          <Ionicons name={VARIANT_ICON[variant]} size={18} color={accent} />
        </View>
        <View style={styles.body}>
          {toast.title ? (
            <Text style={styles.title} numberOfLines={1} testID="app-toast-title">
              {toast.title}
            </Text>
          ) : null}
          <Text style={styles.message} numberOfLines={2} testID="app-toast-message">
            {toast.message}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.22)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 12,
  },
  iconRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  body: { flex: 1 },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.2,
  },
  message: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 2,
  },
});
