// Floating glass tab bar. Translucent, animated active state.
import { Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";

type TabKey = "prayer" | "scripture" | "reflections";

const TAB_META: Record<TabKey, { label: string; icon: keyof typeof Ionicons.glyphMap; iconFocused: keyof typeof Ionicons.glyphMap }> = {
  prayer: { label: "Prayer", icon: "leaf-outline", iconFocused: "leaf" },
  scripture: { label: "Scripture", icon: "book-outline", iconFocused: "book" },
  reflections: { label: "Reflections", icon: "journal-outline", iconFocused: "journal" },
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen name="prayer" options={{ title: "Prayer" }} />
      <Tabs.Screen name="scripture" options={{ title: "Scripture" }} />
      <Tabs.Screen name="reflections" options={{ title: "Reflections" }} />
    </Tabs>
  );
}

function FloatingTabBar(props: any) {
  const { state, navigation } = props;
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 14) }]}
      testID="bottom-tab-bar"
    >
      <BlurView intensity={50} tint="dark" style={styles.bar}>
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
              <TabButton
                key={route.key}
                focused={focused}
                meta={meta}
                onPress={onPress}
                testID={`tab-${route.name}`}
              />
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
  meta: { label: string; icon: keyof typeof Ionicons.glyphMap; iconFocused: keyof typeof Ionicons.glyphMap };
  onPress: () => void;
  testID: string;
}) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.9)).current;
  const pillOpacity = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, { toValue: focused ? 1 : 0.92, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pillOpacity, { toValue: focused ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [focused, scale, pillOpacity]);

  return (
    <Pressable onPress={onPress} style={styles.tab} testID={testID} accessibilityRole="button" accessibilityState={focused ? { selected: true } : {}}>
      <Animated.View style={[styles.pill, { opacity: pillOpacity }]} />
      <Animated.View style={[styles.tabInner, { transform: [{ scale }] }]}>
        <Ionicons
          name={focused ? meta.iconFocused : meta.icon}
          size={20}
          color={focused ? colors.accent : colors.textTertiary}
        />
        <Text style={[styles.label, focused && styles.labelFocused]}>{meta.label}</Text>
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
    paddingHorizontal: 18,
    alignItems: "stretch",
  },
  bar: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "rgba(11,16,32,0.55)",
  },
  barInner: {
    flexDirection: "row",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  pill: {
    ...StyleSheet.absoluteFillObject,
    margin: 4,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
  },
  tabInner: { alignItems: "center", gap: 3 },
  label: { fontFamily: fonts.sansMedium, fontSize: 10.5, color: colors.textTertiary, letterSpacing: 0.3 },
  labelFocused: { color: colors.accent, fontFamily: fonts.sansSemibold },
});
