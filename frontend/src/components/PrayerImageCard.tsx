// Beautiful shareable prayer card. Rendered off-screen and captured as an image.
import { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "@/src/theme/theme";

type Props = {
  prayer: string;
  verseReference?: string;
};

// Sized for a clean portrait social share (4:5 ratio at ~1080 wide).
export const PRAYER_CARD_WIDTH = 1080;
export const PRAYER_CARD_HEIGHT = 1350;

export const PrayerImageCard = forwardRef<View, Props>(function PrayerImageCard(
  { prayer, verseReference },
  ref
) {
  const lines = prayer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <LinearGradient
        colors={[colors.bgTop, colors.bgBottom, colors.bgTop]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.goldGlow} />
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <Text style={styles.dove}>🕊️</Text>
          <Text style={styles.brand}>Prayers Loft</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.eyebrow}>A Prayer</Text>

        <View style={styles.prayerBlock}>
          {lines.map((line, i) => (
            <Text key={i} style={styles.prayerLine}>
              {line}
            </Text>
          ))}
        </View>

        {!!verseReference && (
          <View style={styles.verseRow}>
            <View style={styles.verseRule} />
            <Text style={styles.verseRef}>{verseReference}</Text>
            <View style={styles.verseRule} />
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Pray with us at Prayers Loft</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: PRAYER_CARD_WIDTH,
    height: PRAYER_CARD_HEIGHT,
    backgroundColor: colors.bgTop,
    overflow: "hidden",
  },
  goldGlow: {
    position: "absolute",
    top: -200,
    left: -120,
    width: 700,
    height: 700,
    borderRadius: 700,
    backgroundColor: "rgba(201,168,76,0.08)",
  },
  inner: {
    flex: 1,
    paddingHorizontal: 90,
    paddingTop: 110,
    paddingBottom: 110,
    justifyContent: "space-between",
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 18 },
  dove: { fontSize: 56 },
  brand: { fontFamily: fonts.serifBold, fontSize: 52, color: colors.ivory, letterSpacing: 1 },
  divider: { height: 1, backgroundColor: "rgba(201,168,76,0.35)", marginTop: 36, marginBottom: 48, width: 220 },
  eyebrow: {
    fontFamily: fonts.sansSemibold,
    fontSize: 28,
    letterSpacing: 8,
    color: colors.gold,
    textTransform: "uppercase",
    marginBottom: 36,
  },
  prayerBlock: { gap: 22, flex: 1, justifyContent: "center" },
  prayerLine: {
    fontFamily: fonts.serifItalic,
    fontStyle: "italic",
    fontSize: 56,
    lineHeight: 78,
    color: colors.ivory,
    letterSpacing: 0.5,
  },
  verseRow: { flexDirection: "row", alignItems: "center", gap: 24, marginTop: 36 },
  verseRule: { flex: 1, height: 1, backgroundColor: "rgba(201,168,76,0.35)" },
  verseRef: { fontFamily: fonts.sansSemibold, fontSize: 26, color: colors.gold, letterSpacing: 2 },
  footer: { marginTop: 36, alignItems: "center" },
  footerText: { fontFamily: fonts.sansMedium, fontSize: 24, color: "rgba(250,248,243,0.55)", letterSpacing: 2 },
});
