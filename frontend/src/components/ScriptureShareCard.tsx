// Premium scripture share cards. 3 rotating editorial templates that look
// luxurious and minimal, designed for Stories (1080x1920) and shareable as PNG.
import { forwardRef, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "@/src/theme/theme";

export const SHARE_WIDTH = 1080;
export const SHARE_HEIGHT = 1920;

export type ShareTemplate = "editorial" | "minimal" | "ambient";

export const SHARE_TEMPLATES: ShareTemplate[] = ["editorial", "minimal", "ambient"];

type Props = {
  verse: string;
  reference: string;
  template: ShareTemplate;
};

/** Auto-scale verse size based on length so the composition stays balanced. */
function verseSizing(verse: string) {
  const len = verse.length;
  if (len <= 100) return { fontSize: 78, lineHeight: 108 };
  if (len <= 160) return { fontSize: 68, lineHeight: 96 };
  if (len <= 240) return { fontSize: 58, lineHeight: 84 };
  if (len <= 340) return { fontSize: 50, lineHeight: 72 };
  if (len <= 460) return { fontSize: 42, lineHeight: 62 };
  return { fontSize: 36, lineHeight: 54 };
}

export const ScriptureShareCard = forwardRef<View, Props>(function ScriptureShareCard(
  { verse, reference, template },
  ref
) {
  const sizing = useMemo(() => verseSizing(verse), [verse]);

  if (template === "minimal") return (
    <MinimalCard ref={ref} verse={verse} reference={reference} sizing={sizing} />
  );
  if (template === "ambient") return (
    <AmbientCard ref={ref} verse={verse} reference={reference} sizing={sizing} />
  );
  return <EditorialCard ref={ref} verse={verse} reference={reference} sizing={sizing} />;
});

// ============= Template 1: Editorial Centered =============
const EditorialCard = forwardRef<View, { verse: string; reference: string; sizing: { fontSize: number; lineHeight: number } }>(function EditorialCard(
  { verse, reference, sizing },
  ref
) {
  return (
    <View ref={ref} collapsable={false} style={cardBase.card}>
      <LinearGradient colors={["#0F172A", "#0A1020"]} style={StyleSheet.absoluteFillObject} />
      {/* Warm sand glow centered up top */}
      <View style={[cardBase.glow, { top: -300, left: 140, width: 800, height: 800, borderRadius: 800, backgroundColor: "rgba(200,169,107,0.08)" }]} />
      {/* Subtle vignette via bottom dark fade */}
      <LinearGradient colors={["transparent", "rgba(7,12,28,0.6)"]} style={cardBase.vignette} pointerEvents="none" />

      <View style={editorial.inner}>
        <View style={editorial.brandRow}>
          <View style={editorial.brandDot} />
          <Text style={editorial.brandText}>Prayers Loft</Text>
        </View>

        <View style={editorial.verseBlock}>
          <Text style={editorial.openQuote}>"</Text>
          <Text style={[editorial.verseText, { fontSize: sizing.fontSize, lineHeight: sizing.lineHeight }]}>
            {verse}
          </Text>
          <View style={editorial.rule} />
          <Text style={editorial.reference}>{reference.toUpperCase()}</Text>
          <Text style={editorial.translation}>New Living Translation</Text>
        </View>

        <Text style={editorial.footer}>Shared from Prayers Loft</Text>
      </View>
    </View>
  );
});

// ============= Template 2: Minimal Left-Aligned =============
const MinimalCard = forwardRef<View, { verse: string; reference: string; sizing: { fontSize: number; lineHeight: number } }>(function MinimalCard(
  { verse, reference, sizing },
  ref
) {
  return (
    <View ref={ref} collapsable={false} style={cardBase.card}>
      <LinearGradient colors={["#0F172A", "#0A1020"]} style={StyleSheet.absoluteFillObject} />
      <View style={[cardBase.glow, { top: -200, left: -160, width: 720, height: 720, borderRadius: 720, backgroundColor: "rgba(200,169,107,0.07)" }]} />

      <View style={minimal.inner}>
        <View style={minimal.brandRow}>
          <View style={minimal.brandDot} />
          <Text style={minimal.brandText}>Prayers Loft</Text>
        </View>

        <View style={minimal.verseBlock}>
          <View style={minimal.accentBar} />
          <Text style={[minimal.verseText, { fontSize: sizing.fontSize * 0.92, lineHeight: sizing.lineHeight * 0.95 }]}>
            {verse}
          </Text>
          <Text style={minimal.reference}>{reference}</Text>
        </View>

        <View style={minimal.footerRow}>
          <Text style={minimal.footerText}>NLT</Text>
          <View style={minimal.footerDot} />
          <Text style={minimal.footerText}>Shared from Prayers Loft</Text>
        </View>
      </View>
    </View>
  );
});

// ============= Template 3: Ambient Floating Card =============
const AmbientCard = forwardRef<View, { verse: string; reference: string; sizing: { fontSize: number; lineHeight: number } }>(function AmbientCard(
  { verse, reference, sizing },
  ref
) {
  return (
    <View ref={ref} collapsable={false} style={cardBase.card}>
      <LinearGradient colors={["#1E293B", "#0F172A", "#0A1020"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFillObject} />
      <View style={[cardBase.glow, { top: 400, left: -120, width: 700, height: 700, borderRadius: 700, backgroundColor: "rgba(200,169,107,0.06)" }]} />
      <View style={[cardBase.glow, { top: -100, right: -120, width: 500, height: 500, borderRadius: 500, backgroundColor: "rgba(140,170,220,0.04)" }]} />

      <View style={ambient.inner}>
        <View style={ambient.brandPill}>
          <View style={ambient.brandDot} />
          <Text style={ambient.brandText}>Prayers Loft</Text>
        </View>

        <View style={ambient.glassCard}>
          <Text style={ambient.kicker}>TODAY'S SCRIPTURE</Text>
          <Text style={[ambient.verseText, { fontSize: sizing.fontSize * 0.86, lineHeight: sizing.lineHeight * 0.92 }]}>
            {verse}
          </Text>
          <View style={ambient.refRow}>
            <View style={ambient.refRule} />
            <Text style={ambient.reference}>{reference}</Text>
            <View style={ambient.refRule} />
          </View>
        </View>

        <Text style={ambient.footer}>Shared from Prayers Loft  ·  NLT</Text>
      </View>
    </View>
  );
});

// ============= Shared base styles =============
const cardBase = StyleSheet.create({
  card: {
    width: SHARE_WIDTH,
    height: SHARE_HEIGHT,
    backgroundColor: "#0F172A",
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
  },
  vignette: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 600,
  },
});

const editorial = StyleSheet.create({
  inner: {
    flex: 1,
    paddingHorizontal: 110,
    paddingTop: 140,
    paddingBottom: 110,
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C8A96B" },
  brandText: { fontFamily: fonts.sansMedium, color: "rgba(248,250,252,0.72)", fontSize: 28, letterSpacing: 2 },
  verseBlock: { alignItems: "center", flex: 1, justifyContent: "center", paddingVertical: 40, width: "100%" },
  openQuote: { fontFamily: fonts.serifBold, color: "rgba(200,169,107,0.45)", fontSize: 140, lineHeight: 120, marginBottom: -10 },
  verseText: {
    fontFamily: fonts.serif,
    color: "#F8FAFC",
    textAlign: "center",
    letterSpacing: 0.4,
  },
  rule: { width: 80, height: 1, backgroundColor: "rgba(200,169,107,0.55)", marginTop: 50, marginBottom: 28 },
  reference: { fontFamily: fonts.sansSemibold, color: "#C8A96B", fontSize: 26, letterSpacing: 5 },
  translation: { fontFamily: fonts.sans, color: "rgba(248,250,252,0.42)", fontSize: 20, marginTop: 12, letterSpacing: 1 },
  footer: { fontFamily: fonts.sansMedium, color: "rgba(248,250,252,0.45)", fontSize: 22, letterSpacing: 2 },
});

const minimal = StyleSheet.create({
  inner: {
    flex: 1,
    paddingHorizontal: 100,
    paddingTop: 130,
    paddingBottom: 110,
    justifyContent: "space-between",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C8A96B" },
  brandText: { fontFamily: fonts.sansMedium, color: "rgba(248,250,252,0.72)", fontSize: 28, letterSpacing: 2 },
  verseBlock: { flex: 1, justifyContent: "center", paddingVertical: 40 },
  accentBar: { width: 60, height: 3, backgroundColor: "#C8A96B", marginBottom: 50, borderRadius: 2 },
  verseText: {
    fontFamily: fonts.serif,
    color: "#F8FAFC",
    letterSpacing: 0.2,
  },
  reference: { fontFamily: fonts.sansSemibold, color: "#C8A96B", fontSize: 28, letterSpacing: 4, marginTop: 50 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  footerText: { fontFamily: fonts.sansMedium, color: "rgba(248,250,252,0.45)", fontSize: 22, letterSpacing: 2 },
  footerDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(248,250,252,0.3)" },
});

const ambient = StyleSheet.create({
  inner: {
    flex: 1,
    paddingHorizontal: 90,
    paddingTop: 130,
    paddingBottom: 110,
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C8A96B" },
  brandText: { fontFamily: fonts.sansMedium, color: "rgba(248,250,252,0.85)", fontSize: 26, letterSpacing: 1.8 },
  glassCard: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 40,
    padding: 60,
    gap: 30,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  kicker: {
    fontFamily: fonts.sansMedium,
    color: "#C8A96B",
    fontSize: 22,
    letterSpacing: 5,
  },
  verseText: {
    fontFamily: fonts.serif,
    color: "#F8FAFC",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  refRow: { flexDirection: "row", alignItems: "center", gap: 20, width: "100%", marginTop: 4 },
  refRule: { flex: 1, height: 1, backgroundColor: "rgba(200,169,107,0.35)" },
  reference: { fontFamily: fonts.sansSemibold, color: "#C8A96B", fontSize: 24, letterSpacing: 3 },
  footer: { fontFamily: fonts.sansMedium, color: "rgba(248,250,252,0.45)", fontSize: 22, letterSpacing: 2 },
});
