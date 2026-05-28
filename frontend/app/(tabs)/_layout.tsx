// Bottom tab navigation for Prayers Loft.
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";

type TabKey = "prayer" | "scripture" | "reflections";

const TAB_META: Record<TabKey, { label: string; icon: keyof typeof Ionicons.glyphMap; emoji: string }> = {
  prayer: { label: "Prayer", icon: "leaf-outline", emoji: "🕊️" },
  scripture: { label: "Scripture", icon: "book-outline", emoji: "📖" },
  reflections: { label: "Reflections", icon: "journal-outline", emoji: "📓" },
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bgTop } }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="prayer" options={{ title: "Prayer" }} />
      <Tabs.Screen name="scripture" options={{ title: "Scripture" }} />
      <Tabs.Screen name="reflections" options={{ title: "Reflections" }} />
    </Tabs>
  );
}

function CustomTabBar(props: any) {
  const { state, navigation } = props;
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="bottom-tab-bar">
      {state.routes.map((route: any, index: number) => {
        const focused = state.index === index;
        const meta = TAB_META[route.name as TabKey];
        if (!meta) return null;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={styles.tab}
            testID={`tab-${route.name}`}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
          >
            <Text style={[styles.emoji, focused && styles.emojiFocused]}>{meta.emoji}</Text>
            <Text style={[styles.label, focused && styles.labelFocused]}>{meta.label}</Text>
            {focused && <View style={styles.dot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.navBg,
    borderTopWidth: 1,
    borderTopColor: colors.navBorder,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 6, gap: 4 },
  emoji: { fontSize: 22, opacity: 0.45 },
  emojiFocused: { opacity: 1, transform: [{ scale: 1.08 }] },
  label: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.textMuted, letterSpacing: 0.4 },
  labelFocused: { color: colors.gold, fontFamily: fonts.sansSemibold },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gold, marginTop: 2 },
});
