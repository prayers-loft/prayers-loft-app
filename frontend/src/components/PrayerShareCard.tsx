// Dedicated prayer share card.
// First-person prayers feel different from scripture/devotional content:
// intimate, vulnerable, sacred. The prayer body is the emotional hero.
// Verse reference appears as a subtle footnote, not as a quote graphic.
//
// Four mood templates:
//   - journal       → quiet handwritten-journal feel (paper texture tint)
//   - centered      → minimal centered prayer, lots of breathing room
//   - editorial     → soft editorial reflection with brand row + warm sand bar
//   - candlelight   → ambient warm glow, evokes a lit candle in the dark
//
import { forwardRef, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "@/src/theme/theme";
import { QAFormat, QA_FORMAT_SIZES } from "./QAShareCard";

export type PrayerTemplate = "journal" | "centered" | "editorial" | "candlelight";

export const PRAYER_TEMPLATES: PrayerTemplate[] = ["journal", "centered", "editorial", "candlelight"];

export type PrayerShareCardProps = {
  prayer: string;
  verseReference?: string;
  template: PrayerTemplate;
  format: QAFormat;
};

function prayerSizing(prayer: string, format: QAFormat) {
  const len = prayer.length;
  const f = format;
  const scale = f === "story" ? 1.0 : f === "portrait" ? 0.9 : 0.78;
  let size: number;
  if (len <= 120) size = 64;
  else if (len <= 220) size = 56;
  else if (len <= 340) size = 48;
  else if (len <= 460) size = 42;
  else size = 36;
  const fontSize = Math.round(size * scale);
  return { fontSize, lineHeight: Math.round(fontSize * 1.5) };
}

export const PrayerShareCard = forwardRef<View, PrayerShareCardProps>(function PrayerShareCard(
  { prayer, verseReference, template, format },
  ref
) {
  const sizing = useMemo(() => prayerSizing(prayer, format), [prayer, format]);
  const dims = QA_FORMAT_SIZES[format];
  const lines = useMemo(
    () => prayer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    [prayer]
  );

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[shared.card, { width: dims.width, height: dims.height }]}
    >
      {template === "journal" && (
        <JournalTemplate lines={lines} verseReference={verseReference} sizing={sizing} format={format} />
      )}
      {template === "centered" && (
        <CenteredTemplate lines={lines} verseReference={verseReference} sizing={sizing} format={format} />
      )}
      {template === "editorial" && (
        <EditorialTemplate lines={lines} verseReference={verseReference} sizing={sizing} format={format} />
      )}
      {template === "candlelight" && (
        <CandlelightTemplate lines={lines} verseReference={verseReference} sizing={sizing} format={format} />
      )}
    </View>
  );
});

type TmplProps = {
  lines: string[];
  verseReference?: string;
  sizing: { fontSize: number; lineHeight: number };
  format: QAFormat;
};

function padFor(format: QAFormat) {
  if (format === "story") return { x: 130, top: 150, bottom: 140 };
  if (format === "portrait") return { x: 110, top: 120, bottom: 110 };
  return { x: 95, top: 95, bottom: 90 };
}

// =========================================================================
// Journal — quiet, handwritten-journal feel. Sand paper tint background.
// =========================================================================
function JournalTemplate({ lines, verseReference, sizing, format }: TmplProps) {
  const pad = padFor(format);
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#13192C", "#0F172A", "#0A1020"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Soft warm-sand tint, evokes paper */}
      <View
        style={[
          shared.glow,
          { top: -200, left: -200, width: 900, height: 900, borderRadius: 900, backgroundColor: "rgba(200,169,107,0.06)" },
        ]}
      />
      <View
        style={[
          shared.glow,
          { bottom: -180, right: -200, width: 700, height: 700, borderRadius: 700, backgroundColor: "rgba(232,220,203,0.04)" },
        ]}
      />

      <View style={[shared.frame, { paddingHorizontal: pad.x, paddingTop: pad.top, paddingBottom: pad.bottom }]}>
        <View>
          <Text style={shared.smallLabel}>A Prayer</Text>
          <View style={shared.tinyRule} />
        </View>

        <View style={{ flex: 1, justifyContent: "center" }}>
          <View style={{ gap: Math.round(sizing.lineHeight * 0.22) }}>
            {lines.map((line, i) => (
              <Text
                key={i}
                style={[
                  shared.prayerLine,
                  shared.prayerJournal,
                  { fontSize: sizing.fontSize, lineHeight: sizing.lineHeight },
                ]}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={shared.footerCol}>
          {verseReference ? <Text style={shared.verseFootnote}>{verseReference}</Text> : null}
          <Text style={shared.brandFootnote}>Prayers Loft</Text>
        </View>
      </View>
    </View>
  );
}

// =========================================================================
// Centered — minimal centered prayer. Maximum breathing room.
// =========================================================================
function CenteredTemplate({ lines, verseReference, sizing, format }: TmplProps) {
  const pad = padFor(format);
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient colors={["#0F172A", "#0A1020"]} style={StyleSheet.absoluteFillObject} />
      <View
        style={[
          shared.glow,
          { top: -260, left: 120, width: 820, height: 820, borderRadius: 820, backgroundColor: "rgba(200,169,107,0.06)" },
        ]}
      />

      <View style={[shared.frame, { paddingHorizontal: pad.x, paddingTop: pad.top, paddingBottom: pad.bottom, alignItems: "center" }]}>
        <Text style={shared.smallLabelCentered}>Prayer</Text>

        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", width: "100%" }}>
          <View style={{ gap: Math.round(sizing.lineHeight * 0.2), width: "100%" }}>
            {lines.map((line, i) => (
              <Text
                key={i}
                style={[
                  shared.prayerLine,
                  shared.prayerCentered,
                  { fontSize: sizing.fontSize, lineHeight: sizing.lineHeight, textAlign: "center" },
                ]}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={{ alignItems: "center", gap: 14 }}>
          {verseReference ? <Text style={shared.verseFootnoteCentered}>{verseReference}</Text> : null}
          <View style={shared.brandRow}>
            <View style={shared.brandDotSmall} />
            <Text style={shared.brandFootnoteCentered}>Prayers Loft</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// =========================================================================
// Editorial — soft brand row, vertical sand rule, prayer body left-aligned.
// =========================================================================
function EditorialTemplate({ lines, verseReference, sizing, format }: TmplProps) {
  const pad = padFor(format);
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient colors={["#101A36", "#0F172A", "#0A1020"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFillObject} />
      <View
        style={[
          shared.glow,
          { top: -100, right: -180, width: 700, height: 700, borderRadius: 700, backgroundColor: "rgba(200,169,107,0.07)" },
        ]}
      />

      <View style={[shared.frame, { paddingHorizontal: pad.x, paddingTop: pad.top, paddingBottom: pad.bottom }]}>
        <View style={shared.brandRowEditorial}>
          <View style={shared.brandDot} />
          <Text style={shared.brandTextEditorial}>Prayers Loft</Text>
        </View>

        <View style={{ flex: 1, justifyContent: "center", flexDirection: "row", gap: 32 }}>
          <View style={shared.sandBar} />
          <View style={{ flex: 1, gap: Math.round(sizing.lineHeight * 0.22) }}>
            <Text style={shared.editorialKicker}>A Prayer</Text>
            {lines.map((line, i) => (
              <Text
                key={i}
                style={[
                  shared.prayerLine,
                  shared.prayerEditorial,
                  { fontSize: Math.round(sizing.fontSize * 0.96), lineHeight: Math.round(sizing.lineHeight * 0.96) },
                ]}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={shared.editorialFooterRow}>
          {verseReference ? <Text style={shared.editorialFootnote}>{verseReference}</Text> : null}
          {verseReference ? <View style={shared.footerDot} /> : null}
          <Text style={shared.editorialFootnote}>Prayers Loft</Text>
        </View>
      </View>
    </View>
  );
}

// =========================================================================
// Candlelight — warm ambient glow at bottom, like a lit candle in the dark.
// =========================================================================
function CandlelightTemplate({ lines, verseReference, sizing, format }: TmplProps) {
  const pad = padFor(format);
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient colors={["#0A0F1F", "#0F172A", "#16213D"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFillObject} />
      {/* Candle glow from below */}
      <View
        style={[
          shared.glow,
          { bottom: -300, left: "50%", marginLeft: -500, width: 1000, height: 700, borderRadius: 700, backgroundColor: "rgba(212,153,89,0.16)" },
        ]}
      />
      <View
        style={[
          shared.glow,
          { bottom: -150, left: "50%", marginLeft: -300, width: 600, height: 400, borderRadius: 600, backgroundColor: "rgba(232,176,107,0.18)" },
        ]}
      />
      {/* Top vignette */}
      <LinearGradient
        colors={["rgba(10,15,30,0.55)", "transparent"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 400 }}
        pointerEvents="none"
      />

      <View style={[shared.frame, { paddingHorizontal: pad.x, paddingTop: pad.top, paddingBottom: pad.bottom, alignItems: "center" }]}>
        <Text style={shared.candleLabel}>Prayer</Text>

        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", width: "100%" }}>
          <View style={{ gap: Math.round(sizing.lineHeight * 0.22), width: "100%" }}>
            {lines.map((line, i) => (
              <Text
                key={i}
                style={[
                  shared.prayerLine,
                  shared.prayerCandle,
                  { fontSize: sizing.fontSize, lineHeight: sizing.lineHeight, textAlign: "center" },
                ]}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={{ alignItems: "center", gap: 16 }}>
          {verseReference ? <Text style={shared.candleFootnote}>{verseReference}</Text> : null}
          <Text style={shared.candleBrand}>Prayers Loft</Text>
        </View>
      </View>
    </View>
  );
}

const shared = StyleSheet.create({
  card: {
    backgroundColor: "#0F172A",
    overflow: "hidden",
  },
  glow: { position: "absolute" },
  frame: { flex: 1, justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandRowEditorial: { flexDirection: "row", alignItems: "center", gap: 14 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C8A96B" },
  brandDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#C8A96B" },
  brandTextEditorial: {
    fontFamily: fonts.sansMedium,
    color: "rgba(248,250,252,0.7)",
    fontSize: 26,
    letterSpacing: 2,
  },

  smallLabel: {
    fontFamily: fonts.sansMedium,
    color: "#C8A96B",
    fontSize: 22,
    letterSpacing: 6,
    textTransform: "uppercase",
  },
  smallLabelCentered: {
    fontFamily: fonts.sansMedium,
    color: "#C8A96B",
    fontSize: 22,
    letterSpacing: 7,
    textTransform: "uppercase",
  },
  tinyRule: { width: 36, height: 1, backgroundColor: "rgba(200,169,107,0.5)", marginTop: 16 },

  prayerLine: {
    fontFamily: fonts.serifItalic,
    fontStyle: "italic",
    color: "#F8FAFC",
    letterSpacing: 0.3,
  },
  prayerJournal: { color: "#F2EBDF" },
  prayerCentered: { color: "#F8FAFC" },
  prayerEditorial: { color: "#F8FAFC", letterSpacing: 0.2 },
  prayerCandle: { color: "#FAF1E1", letterSpacing: 0.2 },

  footerCol: { gap: 10 },
  verseFootnote: {
    fontFamily: fonts.sansMedium,
    color: "rgba(200,169,107,0.85)",
    fontSize: 22,
    letterSpacing: 3,
  },
  brandFootnote: {
    fontFamily: fonts.sans,
    color: "rgba(248,250,252,0.4)",
    fontSize: 20,
    letterSpacing: 2,
  },
  verseFootnoteCentered: {
    fontFamily: fonts.sansMedium,
    color: "rgba(200,169,107,0.85)",
    fontSize: 22,
    letterSpacing: 4,
  },
  brandFootnoteCentered: {
    fontFamily: fonts.sansMedium,
    color: "rgba(248,250,252,0.45)",
    fontSize: 20,
    letterSpacing: 2,
  },

  sandBar: {
    width: 3,
    backgroundColor: "rgba(200,169,107,0.55)",
    borderRadius: 2,
  },
  editorialKicker: {
    fontFamily: fonts.sansMedium,
    color: "#C8A96B",
    fontSize: 20,
    letterSpacing: 5,
    textTransform: "uppercase",
    marginBottom: 24,
  },
  editorialFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  editorialFootnote: {
    fontFamily: fonts.sansMedium,
    color: "rgba(248,250,252,0.5)",
    fontSize: 20,
    letterSpacing: 2,
  },
  footerDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(248,250,252,0.3)" },

  candleLabel: {
    fontFamily: fonts.sansMedium,
    color: "rgba(232,212,170,0.85)",
    fontSize: 22,
    letterSpacing: 7,
    textTransform: "uppercase",
  },
  candleFootnote: {
    fontFamily: fonts.sansMedium,
    color: "rgba(232,200,150,0.85)",
    fontSize: 22,
    letterSpacing: 4,
  },
  candleBrand: {
    fontFamily: fonts.sans,
    color: "rgba(248,232,200,0.42)",
    fontSize: 20,
    letterSpacing: 2,
  },
});
