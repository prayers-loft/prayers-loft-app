// First-launch onboarding carousel. 4 slides, swipeable + button-paced.
// Stores completion in AsyncStorage so it's shown only once. On completion,
// routes the user to today's verse (see FIRST_ACTION_ROUTE in lib/onboarding).
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  Dimensions,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  DeviceEventEmitter,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";
import {
  FIRST_ACTION_ROUTE,
  hasSeenOnboarding,
  markOnboardingSeen,
  ONBOARDING_REPLAY_EVENT,
} from "@/src/lib/onboarding";

// Copy audit (Build 16 spec):
//   • Benefit-driven — every slide says what the user *gets*, not what
//     the app *does*.
//   • Concrete — no vague "spiritual growth" language.
//   • Warm but not preachy.
//   • Reminders framed as optional (footnote on the last slide, not its
//     own slide) since we don't request the OS permission here.
const SLIDES = [
  {
    key: "scripture",
    icon: "book-outline" as const,
    title: "A verse for every day",
    body:
      "Open the app to today's Scripture with a short devotional written for right now.",
  },
  {
    key: "pray",
    icon: "heart-outline" as const,
    title: "Prayers made for what you're carrying",
    body:
      "Share what's on your mind and receive a personalized prayer grounded in Scripture.",
  },
  {
    key: "reflect",
    icon: "sparkles-outline" as const,
    title: "Guided reflection, kept in a Journal",
    body:
      "Sit with a verse, jot a thought, and watch your streak grow as you keep showing up.",
  },
  {
    key: "reminder",
    icon: "notifications-outline" as const,
    title: "A gentle nudge, only if you want it",
    body:
      "Turn on optional daily reminders in Settings whenever you're ready — never before.",
  },
];

export function OnboardingHost() {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const { width } = Dimensions.get("window");
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Initial check on mount — fires for genuine first-time users only.
    (async () => {
      // Skip onboarding under automated test runners (Playwright sets navigator.webdriver).
      try {
        if (
          typeof navigator !== "undefined" &&
          // @ts-ignore
          (navigator.webdriver === true || (globalThis as any).__PRAYERSLOFT_SKIP_ONBOARDING__)
        ) {
          await markOnboardingSeen();
          return;
        }
      } catch {
        // ignore
      }
      const seen = await hasSeenOnboarding();
      if (!seen) {
        showCarousel();
      }
    })();

    // Listener — Settings → Developer Tools → Replay Onboarding emits this.
    const sub = DeviceEventEmitter.addListener(ONBOARDING_REPLAY_EVENT, () => {
      setIndex(0);
      // Snap scroll back to first slide on next paint.
      requestAnimationFrame(() => {
        try {
          scrollRef.current?.scrollTo({ x: 0, animated: false });
        } catch {
          // ignore
        }
      });
      showCarousel();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showCarousel() {
    setVisible(true);
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }

  /** Dismiss the carousel and optionally route the user to their first
   *  meaningful action. Skip → no route change (respect user intent).
   *  Get Started → route to today's verse (the strongest first action).
   */
  async function finish(routeToFirstAction: boolean) {
    // Storage write is wrapped in try/catch inside markOnboardingSeen —
    // failures never block dismissal. See lib/onboarding.ts.
    await markOnboardingSeen();
    Animated.timing(opacity, {
      toValue: 0,
      duration: 260,
      easing: Easing.in(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    }).start(({ finished }) => {
      if (finished) setVisible(false);
      if (routeToFirstAction) {
        // Route after animation completes so the transition to the tab
        // isn't visually stacked on top of the fade-out.
        try {
          router.replace(FIRST_ACTION_ROUTE);
        } catch (e) {
          // Router unavailable (deep-link race, cold navigation state)
          // is non-fatal — user is already in the app.
          console.warn("[onboarding] first-action route failed", e);
        }
      }
    });
  }

  function goTo(i: number) {
    setIndex(i);
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
  }

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(i);
  }

  if (!visible) return null;
  const isLast = index === SLIDES.length - 1;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={false}
      statusBarTranslucent
      onRequestClose={() => void finish(false)}
    >
      <Animated.View style={[styles.root, { opacity }]} testID="onboarding">
        {/* Top bar: centered brand wordmark + Skip pinned to the right.
            The brand sits below the safe area (paddingTop already accounts for
            the status bar) and is the first visible element on every slide. */}
        <View style={styles.topBar}>
          <Text style={styles.brandWordmark} testID="onboarding-brand" accessibilityRole="header">
            Prayers Loft
          </Text>
          <Pressable
            onPress={() => void finish(false)}
            hitSlop={12}
            style={styles.skipPressable}
            testID="onboarding-skip"
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          style={{ flex: 1 }}
          testID="onboarding-scroll"
        >
          {SLIDES.map((s) => (
            <View key={s.key} style={[styles.slide, { width }]}>
              <View style={styles.iconRing}>
                <Ionicons name={s.icon} size={36} color={colors.accent} />
              </View>
              <Text style={styles.title} testID={`onboarding-title-${s.key}`}>
                {s.title}
              </Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Dots */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>

        {/* Action */}
        <View style={styles.cta}>
          <Pressable
            onPress={() =>
              isLast ? void finish(true) : goTo(index + 1)
            }
            style={styles.ctaBtn}
            testID={isLast ? "onboarding-get-started" : "onboarding-next"}
            accessibilityRole="button"
            accessibilityLabel={
              isLast ? "Get started with today's verse" : "Next slide"
            }
          >
            <Text style={styles.ctaText}>
              {isLast ? "Read today's verse" : "Next"}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    // Center the brand wordmark. Skip is absolutely positioned to the right
    // so the brand stays visually centered regardless of "Skip" text width.
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 24,
    position: "relative",
  },
  brandWordmark: {
    // Match the in-app ScreenHeader brand (sansMedium, textPrimary,
    // letterSpacing 0.6) but slightly larger so it reads as intentional
    // onboarding branding. NO gold per spec.
    // marginTop pushes the brand ~48px below the safe-area top so it sits
    // visually inside the onboarding content area rather than feeling
    // attached to the status bar. Skip stays pinned to the safe-area edge
    // via its own absolute positioning, so this only affects the brand.
    fontFamily: fonts.sansMedium,
    fontSize: 18,
    color: colors.textPrimary,
    letterSpacing: 0.6,
    textAlign: "center",
    marginTop: 48,
  },
  skipPressable: {
    position: "absolute",
    right: 20,
    top: 56,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skipText: {
    fontFamily: fonts.sansMedium,
    color: colors.textSecondary,
    fontSize: 14,
  },
  slide: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
  },
  iconRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(200,169,107,0.10)",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.32)",
    marginBottom: 28,
  },
  title: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    textAlign: "center",
    marginBottom: 14,
  },
  body: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    maxWidth: 320,
  },
  dots: { flexDirection: "row", justifyContent: "center", paddingVertical: 16 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.20)",
    marginHorizontal: 4,
  },
  dotActive: { backgroundColor: colors.accent, width: 22 },
  cta: { paddingHorizontal: 28, paddingBottom: 38, paddingTop: 6 },
  ctaBtn: {
    minHeight: 52,
    backgroundColor: colors.accent,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontFamily: fonts.sansSemibold,
    color: "#0c1024",
    fontSize: 16,
    letterSpacing: 0.2,
  },
});
