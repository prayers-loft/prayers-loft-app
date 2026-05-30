// Premium opening animation overlay for Prayers Loft.
//
// Plays once per cold launch (skipped when the JS module is already warm,
// which is the case when the OS restores the app from background).
// Honors the user's "Reduce Motion" accessibility preference.
//
// Sequence (≈1.9s total):
//   1. Midnight indigo background is already painted by the app shell.
//   2. Warm sand glow softly fades in and "breathes" outward.
//   3. Leaf mark fades in, drifts up gently, scales 0.96 → 1.0.
//   4. "Prayers Loft" wordmark fades in beneath the mark.
//   5. Whole overlay fades out and unmounts; the app is revealed.
//
import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "@/src/theme/theme";

// Module-level flag: ensures we only ever play the intro animation on a
// genuine cold launch. Hot reload during dev, route changes, and resume from
// background will all read `true` here and bypass the overlay.
let hasPlayedThisSession = false;

export function SplashOverlay({ onDone }: { onDone?: () => void }) {
  const [shouldRender, setShouldRender] = useState(!hasPlayedThisSession);
  const [reduceMotion, setReduceMotion] = useState(false);

  const containerOpacity = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(0.7);
  const markOpacity = useSharedValue(0);
  const markTranslate = useSharedValue(10);
  const markScale = useSharedValue(0.96);
  const wordOpacity = useSharedValue(0);

  useEffect(() => {
    if (!shouldRender) return;

    let cancelled = false;
    (async () => {
      // Detect reduce-motion (best-effort, non-blocking).
      try {
        const rm = await AccessibilityInfo.isReduceMotionEnabled();
        if (cancelled) return;
        setReduceMotion(!!rm);
        runIntro(!!rm);
      } catch {
        runIntro(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRender]);

  // NOTE: We intentionally do not listen to AppState here. On a cold launch
  // there is no prior "background → active" transition; the intro plays once
  // (gated by the module-level `hasPlayedThisSession` flag) and subsequent
  // re-mounts within the same JS session bypass it.

  const finish = (skip = false) => {
    hasPlayedThisSession = true;
    if (skip) {
      setShouldRender(false);
      onDone?.();
      return;
    }
    containerOpacity.value = withTiming(
      0,
      { duration: 320, easing: Easing.in(Easing.cubic) },
      () => {
        runOnJS(setShouldRender)(false);
        if (onDone) runOnJS(onDone)();
      }
    );
  };

  const runIntro = (rm: boolean) => {
    if (rm) {
      // Reduced motion: simple instant fade — no transforms.
      glowOpacity.value = withTiming(0.6, { duration: 180 });
      markOpacity.value = withTiming(1, { duration: 220 });
      wordOpacity.value = withDelay(160, withTiming(1, { duration: 220 }));
      // Hold ~700ms then fade out.
      setTimeout(() => finish(false), 800);
      return;
    }

    // Glow breathes in and softly expands.
    glowOpacity.value = withTiming(0.9, { duration: 900, easing: Easing.out(Easing.cubic) });
    glowScale.value = withSequence(
      withTiming(1.05, { duration: 1300, easing: Easing.out(Easing.cubic) }),
      withTiming(1.12, { duration: 700, easing: Easing.inOut(Easing.cubic) })
    );

    // Mark fades in with slight upward drift + tiny scale rise.
    markOpacity.value = withDelay(280, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
    markTranslate.value = withDelay(280, withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }));
    markScale.value = withDelay(280, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));

    // Wordmark settles in slightly after the leaf.
    wordOpacity.value = withDelay(720, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));

    // Hold then fade the whole overlay away.
    setTimeout(() => finish(false), 1850);
  };

  const containerStyle = useAnimatedStyle(() => ({ opacity: containerOpacity.value }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [
      { translateY: markTranslate.value },
      { scale: markScale.value },
    ],
  }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: wordOpacity.value }));

  if (!shouldRender) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFillObject, styles.root, containerStyle, { pointerEvents: "none" }]}
    >
      {/* Background gradient — matches the in-app palette so the handoff is seamless. */}
      <LinearGradient
        colors={["#0F172A", "#0A1020"]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Warm sand breathing glow */}
      <Animated.View style={[styles.glowWrap, glowStyle]}>
        <View style={styles.glowOuter} />
        <View style={styles.glowInner} />
      </Animated.View>

      {/* Center stack */}
      <View style={[styles.center, { pointerEvents: "none" }]}>
        <Animated.View style={[styles.markRing, markStyle]}>
          <Ionicons name="leaf-outline" size={44} color={colors.accent} />
        </Animated.View>
        <Animated.Text style={[styles.wordmark, wordStyle]} allowFontScaling={false}>
          Prayers Loft
        </Animated.Text>
        <Animated.View style={[styles.dotRow, wordStyle]}>
          <View style={styles.dot} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#0A1020",
    alignItems: "center",
    justifyContent: "center",
  },
  glowWrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  glowOuter: {
    width: 520,
    height: 520,
    borderRadius: 520,
    backgroundColor: "rgba(200,169,107,0.08)",
  },
  glowInner: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 280,
    backgroundColor: "rgba(200,169,107,0.10)",
  },
  center: { alignItems: "center", justifyContent: "center", gap: 18 },
  markRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.22)",
  },
  wordmark: {
    fontFamily: fonts.sansMedium,
    color: "rgba(248,250,252,0.92)",
    fontSize: 18,
    letterSpacing: 4,
    textTransform: "uppercase",
    marginTop: 4,
  },
  dotRow: { flexDirection: "row", justifyContent: "center", marginTop: 2 },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});
