// First-launch onboarding carousel. 3 slides, swipeable + button-paced.
// Stores completion in AsyncStorage so it's shown only once.
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";
import { hasSeenOnboarding, markOnboardingSeen } from "@/src/lib/onboarding";

const SLIDES = [
  {
    key: "pray",
    icon: "heart-outline" as const,
    title: "A quiet place to pray.",
    body: "Share what's on your heart and receive personalized prayers rooted in Scripture.",
  },
  {
    key: "scripture",
    icon: "book-outline" as const,
    title: "Scripture for today.",
    body: "Receive daily verses, devotionals, and thoughtful biblical insight.",
  },
  {
    key: "journey",
    icon: "leaf-outline" as const,
    title: "Keep your journey.",
    body: "Reflect, build streaks, and save meaningful moments as your faith grows.",
  },
];

export function OnboardingHost() {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const { width } = Dimensions.get("window");
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
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
      } catch {}
      const seen = await hasSeenOnboarding();
      if (!seen) {
        setVisible(true);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }).start();
      }
    })();
  }, [opacity]);

  async function finish() {
    await markOnboardingSeen();
    Animated.timing(opacity, {
      toValue: 0,
      duration: 260,
      easing: Easing.in(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    }).start(({ finished }) => {
      if (finished) setVisible(false);
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
      onRequestClose={finish}
    >
      <Animated.View style={[styles.root, { opacity }]} testID="onboarding">
        {/* Skip */}
        <View style={styles.topBar}>
          <Pressable onPress={finish} hitSlop={12} testID="onboarding-skip">
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
            onPress={() => (isLast ? finish() : goTo(index + 1))}
            style={styles.ctaBtn}
            testID={isLast ? "onboarding-get-started" : "onboarding-next"}
          >
            <Text style={styles.ctaText}>{isLast ? "Get Started" : "Next"}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
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
