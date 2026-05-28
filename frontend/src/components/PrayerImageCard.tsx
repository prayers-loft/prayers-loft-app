// Beautiful shareable prayer card. Rendered off-screen and captured as an image.
import { forwardRef, useMemo } from "react";
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

// Auto-scale font size based on prayer length so long prayers always fit.
function pickPrayerSizing(prayer: string, lineCount: number) {
  const chars = prayer.length;
  // We have roughly 900px of vertical space for the prayer block.
  // Empirically tuned ramp:
  if (chars <= 220 && lineCount <= 5) return { fontSize: 52, lineHeight: 70, gap: 22 };
  if (chars <= 360 && lineCount <= 7) return { fontSize: 44, lineHeight: 60, gap: 18 };
  if (chars <= 520 && lineCount <= 9) return { fontSize: 38, lineHeight: 52, gap: 14 };
  if (chars <= 720) return { fontSize: 32, lineHeight: 44, gap: 12 };
  return { fontSize: 28, lineHeight: 38, gap: 10 };
}

export const PrayerImageCard = forwardRef<View, Props>(function PrayerImageCard(
  { prayer, verseReference },
  ref
) {
  const lines = useMemo(
    () => prayer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    [prayer]
  );
  const sizing = useMemo(() => pickPrayerSizing(prayer, lines.length), [prayer, lines.length]);

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <LinearGradient
        colors={[colors.bgTop, colors.bgBottom, colors.bgTop]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.goldGlow} />
      <View style={styles.inner}>
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.dove}>🕊️</Text>
            <Text style={styles.brand}>Prayers Loft</Text>
          </View>
          <View style={styles.divider} />
          <Text style={styles.eyebrow}>A Prayer For You</Text>
        </View>

        <View style={[styles.prayerBlock, { gap: sizing.gap }]}>
          {lines.map((line, i) => (
            <Text
              key={i}
              style={[
                styles.prayerLine,
                { fontSize: sizing.fontSize, lineHeight: sizing.lineHeight },
              ]}
            >
              {line}
            </Text>
          ))}
        </View>

        <View>
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
    paddingTop: 90,
    paddingBottom: 80,
    justifyContent: "space-between",
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 18 },
  dove: { fontSize: 56 },
  brand: { fontFamily: fonts.serifBold, fontSize: 52, color: colors.ivory, letterSpacing: 1 },
  divider: { height: 1, backgroundColor: "rgba(201,168,76,0.35)", marginTop: 30, marginBottom: 30, width: 220 },
  eyebrow: {
    fontFamily: fonts.serifItalic,
    fontStyle: "italic",
    fontSize: 44,
    color: colors.gold,
    letterSpacing: 1,
  },
  prayerBlock: { flex: 1, justifyContent: "center", paddingVertical: 24 },
  prayerLine: {
    fontFamily: fonts.serifItalic,
    fontStyle: "italic",
    color: colors.ivory,
    letterSpacing: 0.5,
  },
  verseRow: { flexDirection: "row", alignItems: "center", gap: 24, marginBottom: 28 },
  verseRule: { flex: 1, height: 1, backgroundColor: "rgba(201,168,76,0.35)" },
  verseRef: { fontFamily: fonts.sansSemibold, fontSize: 26, color: colors.gold, letterSpacing: 2 },
  footer: { alignItems: "center" },
  footerText: { fontFamily: fonts.sansMedium, fontSize: 24, color: "rgba(250,248,243,0.55)", letterSpacing: 2 },
});
