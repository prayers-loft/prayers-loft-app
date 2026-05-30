// Minimal header. Brand mark on left, ambient toggle + settings gear on right.
import { StyleSheet, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AmbientToggle } from "@/src/components/AmbientToggle";
import { colors, fonts } from "@/src/theme/theme";

export function ScreenHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
      <View style={styles.brand}>
        <View style={styles.dot} />
        <Text style={styles.brandText}>Prayers Loft</Text>
      </View>
      <View style={styles.actions}>
        <AmbientToggle />
        <Pressable
          onPress={() => router.push("/settings")}
          hitSlop={10}
          style={styles.settingsBtn}
          testID="settings-icon-button"
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  brandText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  settingsBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
});
