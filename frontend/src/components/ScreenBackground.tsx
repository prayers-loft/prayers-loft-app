// Ambient background with soft layered radial glows for depth.
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import { colors } from "@/src/theme/theme";

export function ScreenBackground({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.bgDeep, colors.bg, colors.bgDeep]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Top-right warm gold glow */}
      <View style={[styles.glow, styles.glowGold]} />
      {/* Bottom-left cool blue glow */}
      <View style={[styles.glow, styles.glowBlue]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  glow: {
    position: "absolute",
    pointerEvents: "none",
  },
  glowGold: {
    top: -140,
    right: -120,
    width: 380,
    height: 380,
    borderRadius: 380,
    backgroundColor: "rgba(212,179,106,0.07)",
  },
  glowBlue: {
    bottom: 40,
    left: -150,
    width: 360,
    height: 360,
    borderRadius: 360,
    backgroundColor: "rgba(108,140,200,0.05)",
  },
});
