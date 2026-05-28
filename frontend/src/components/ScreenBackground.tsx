// Shared full-screen gradient background with subtle gold ambient texture.
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import { colors } from "@/src/theme/theme";

export function ScreenBackground({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.bgTop, colors.bgBottom, colors.bgTop]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Soft radial gold glow at top */}
      <View pointerEvents="none" style={styles.glow} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  glow: {
    position: "absolute",
    top: -120,
    left: -60,
    width: 360,
    height: 360,
    borderRadius: 360,
    backgroundColor: "rgba(201,168,76,0.06)",
  },
});
