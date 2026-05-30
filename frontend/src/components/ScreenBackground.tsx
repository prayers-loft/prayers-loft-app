// Quiet ambient background. Single very soft warm glow + cool depth gradient.
// The content should always remain the focus.
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import { colors } from "@/src/theme/theme";

export function ScreenBackground({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.bg, colors.bgDeep]}
        locations={[0, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {/* A single very large, very soft warm glow up top. Quiet atmosphere. */}
      <View style={[styles.glow, { pointerEvents: "none" }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  glow: {
    position: "absolute",
    top: -260,
    left: -120,
    right: -120,
    height: 600,
    borderRadius: 600,
    backgroundColor: "rgba(200,169,107,0.045)",
  },
});
