// Floating glass tab bar — slim, very translucent, calm.
import { Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";

type TabKey = "walk" | "prayer" | "scripture" | "bible-assistant";

// Product philosophy (June 2026): Prayers Loft is one discipleship experience
// supported by four capabilities. Walk is the heart; Prayer, Scripture, and
// Study support it.
//   Walk       — ongoing discipleship (how am I growing?)
//   Prayer     — talking to God
//   Scripture  — receiving God's Word
//   Study      — deeper study & questions (the old "Bible Assistant" label
//                exposed the AI mechanics; "Study" is what the user is
//                actually doing)
const TAB_META: Record<TabKey, { icon: keyof typeof Ionicons.glyphMap; iconFocused: keyof typeof Ionicons.glyphMap; label: string }> = {
  walk: { icon: "compass-outline", iconFocused: "compass", label: "Walk" },
  prayer: { icon: "leaf-outline", iconFocused: "leaf", label: "Prayer" },
  scripture: { icon: "book-outline", iconFocused: "book", label: "Scripture" },
  "bible-assistant": { icon: "school-outline", iconFocused: "school", label: "Study" },
};

export default function TabsLayout() {
  return (
    <Tabs
      // initialRouteName is intentionally "prayer" so existing users retain
      // their landing behavior even after the Walk tab is added. New users
      // are routed to /walk by the onboarding completion flow (added later).
      initialRouteName="prayer"
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen name="walk" />
      <Tabs.Screen name="prayer" />
      <Tabs.Screen name="scripture" />
      <Tabs.Screen name="bible-assistant" />
    </Tabs>
  );
}

function FloatingTabBar(props: any) {
  const { state, navigation } = props;
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12), pointerEvents: "box-none" }]}
      testID="bottom-tab-bar"
    >
      <BlurView intensity={70} tint="dark" style={styles.bar}>
        <View style={styles.barInner}>
          {state.routes.map((route: any, index: number) => {
            const focused = state.index === index;
            const meta = TAB_META[route.name as TabKey];
            if (!meta) return null;
            const onPress = () => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };
            return (
              <TabButton key={route.key} focused={focused} meta={meta} onPress={onPress} testID={`tab-${route.name}`} />
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

function TabButton({
  focused,
  meta,
  onPress,
  testID,
}: {
  focused: boolean;
  meta: { icon: keyof typeof Ionicons.glyphMap; iconFocused: keyof typeof Ionicons.glyphMap; label: string };
  onPress: () => void;
  testID: string;
}) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.94)).current;
  const dotOpacity = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, { toValue: focused ? 1 : 0.94, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(dotOpacity, { toValue: focused ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [focused, scale, dotOpacity]);

  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={meta.label}
      accessibilityState={focused ? { selected: true } : {}}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale }] }]}>
        <View style={styles.iconSlot}>
          <Ionicons
            name={focused ? meta.iconFocused : meta.icon}
            size={20}
            color={focused ? colors.accent : colors.textTertiary}
          />
        </View>
        <Text
          style={[
            styles.label,
            { color: focused ? colors.accent : colors.textTertiary },
            focused && styles.labelFocused,
          ]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {meta.label}
        </Text>
        <Animated.View style={[styles.dot, { opacity: dotOpacity }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 32,
    alignItems: "stretch",
  },
  bar: {
    borderRadius: 32,
    overflow: "hidden",
    backgroundColor: "rgba(15,23,42,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  barInner: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tab: { flex: 1, alignItems: "stretch", justifyContent: "center", paddingVertical: 4 },
  tabInner: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  iconSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    letterSpacing: 1,
    // The trailing letter-spacing pushes the text's bounding box wider on the
    // right than visually balanced. Mirror that as left padding so the
    // perceived center matches the geometric center of the column.
    paddingLeft: 1,
    textTransform: "uppercase",
    textAlign: "center",
    alignSelf: "center",
    marginTop: 1,
    includeFontPadding: false,
  },
  labelFocused: {
    fontFamily: fonts.sansSemibold,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: 2,
    alignSelf: "center",
  },
});
