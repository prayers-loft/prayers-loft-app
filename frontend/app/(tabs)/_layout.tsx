// Bottom tab navigation for Prayers Loft. Contemporary icon-based design.
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
            <View style={[styles.iconWrap, focused && styles.iconWrapFocused]}>
              <Ionicons
                name={focused ? meta.iconFocused : meta.icon}
                size={20}
                color={focused ? colors.gold : colors.textSecondary}
              />
            </View>
            <Text style={[styles.label, focused && styles.labelFocused]}>{meta.label}</Text>
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
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4, gap: 4 },
  iconWrap: {
    width: 40,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  iconWrapFocused: {
    backgroundColor: "rgba(201,168,76,0.12)",
  },
  label: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.textMuted, letterSpacing: 0.3 },
  labelFocused: { color: colors.gold, fontFamily: fonts.sansSemibold },
});
