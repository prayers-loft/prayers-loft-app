// Lightweight in-app toast/banner system.
// Slides down from the top with a Reanimated-free Animated API (cross-platform
// safe). Auto-dismisses after `duration` (default 2.4s — short enough to feel
// like an iOS system confirmation, long enough to read a two-line message).
// One-toast-at-a-time; new toasts replace any visible one.
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
import { BlurView } from "expo-blur";
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
      const ms = payload.duration ?? 2400;
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
  // Sit below the app header, not on top of it.
  //
  // ScreenHeader on the main tabs (Prayer / Scripture / Bible Assistant)
  // occupies roughly `insets.top + 56` — that's `insets.top + 14` paddingTop
  // plus a 36px avatar (the tallest child) plus 6px paddingBottom. The
  // reflections-history and settings screens use a lighter custom header at
  // roughly `insets.top + 46`. We anchor to the tallest of those + a small
  // gap so the toast never overlaps the "Prayers Loft" wordmark or the
  // profile avatar on any iPhone size (SE through 15 Pro Max).
  //
  // The `insets.top || 12` fallback matches the pre-fix behavior on the
  // web preview where useSafeAreaInsets returns 0.
  const HEADER_HEIGHT = 56;
  const top = (insets.top || 12) + HEADER_HEIGHT + 8;

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
        {/* Subtle iOS-style backdrop blur behind an almost-opaque deep-navy
            surface. The blur is a nice-to-have polish on native; on web
            (Metro preview) BlurView renders as a semi-transparent overlay
            which still looks premium against the near-solid background. */}
        <BlurView
          intensity={40}
          tint="dark"
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        <View style={styles.cardOverlay} pointerEvents="none" />
        <View style={[styles.iconRing, { borderColor: `${accent}66`, backgroundColor: `${accent}22` }]}>
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
  // Premium iOS-notification style: near-opaque deep-navy surface (matches
  // colors.bgDeep at 96% opacity so it fully occludes underlying content),
  // paired with a soft warm-sand ring instead of a hard gold border. The
  // BlurView underneath supplies a subtle blur on native. Elevation stacks
  // the toast above tabs, cards, and modals.
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(200,169,107,0.14)",
    overflow: "hidden",
    // iOS-style drop shadow — deeper and softer than the previous 8/16
    // pair. Elevation 16 keeps parity on Android.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.44,
    shadowRadius: 22,
    elevation: 16,
  },
  // Deep-navy surface layered on top of the BlurView so the toast reads
  // as a solid, high-contrast panel even when the underlying content is
  // busy. Alpha is 0.96 so the blur still peeks through just enough to
  // feel like a real iOS notification.
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.96)",
    borderRadius: 16,
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
    // Full-white title for maximum contrast against the deep-navy surface.
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  message: {
    fontFamily: fonts.sans,
    fontSize: 13,
    // Slightly dimmer than the title (77% white) — hierarchy without
    // losing legibility. Compare with previous colors.textSecondary (68%)
    // which felt washed out against the previous translucent surface.
    color: "rgba(255,255,255,0.78)",
    lineHeight: 18,
    marginTop: 2,
  },
});
