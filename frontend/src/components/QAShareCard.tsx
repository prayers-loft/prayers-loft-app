// Shareable Q&A response card (Devotional / Theologian).
// Three templates, three aspect ratios, designed for the
// Midnight Indigo + Warm Sand aesthetic.
import { forwardRef, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "@/src/theme/theme";

export type QAFormat = "portrait" | "square" | "story";
export type QATemplate = "centered" | "reflection" | "insight";

export const QA_FORMAT_SIZES: Record<QAFormat, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

export type QAShareCardProps = {
  excerpt: string;
  reference: string;
  question?: string;
  style: "Devotional" | "Theologian";
  template: QATemplate;
  format: QAFormat;
};

/** Auto-size excerpt text to fit its container without crowding. */
function excerptSizing(
  text: string,
  format: QAFormat
): { fontSize: number; lineHeight: number } {
  const len = text.length;
  const f = format;
  const scale = f === "story" ? 1.0 : f === "portrait" ? 0.88 : 0.78;
  let size: number;
  if (len <= 80) size = 78;
  else if (len <= 140) size = 70;
  else if (len <= 200) size = 60;
  else if (len <= 260) size = 52;
  else size = 46;
  const fontSize = Math.round(size * scale);
  return { fontSize, lineHeight: Math.round(fontSize * 1.42) };
}

export const QAShareCard = forwardRef<View, QAShareCardProps>(function QAShareCard(
  { excerpt, reference, question, style, template, format },
  ref
) {
  const sizing = useMemo(() => excerptSizing(excerpt, format), [excerpt, format]);
  const dims = QA_FORMAT_SIZES[format];

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[shared.card, { width: dims.width, height: dims.height }]}
    >
      {template === "centered" && (
        <CenteredTemplate
          excerpt={excerpt}
          reference={reference}
          question={question}
          style={style}
          sizing={sizing}
          format={format}
        />
      )}
      {template === "reflection" && (
        <ReflectionTemplate
          excerpt={excerpt}
          reference={reference}
          question={question}
          style={style}
          sizing={sizing}
          format={format}
        />
      )}
      {template === "insight" && (
        <InsightTemplate
          excerpt={excerpt}
          reference={reference}
          question={question}
          style={style}
          sizing={sizing}
          format={format}
        />
      )}
    </View>
  );
});

// =========================================================================
// Template 1 — Centered (Devotional default)
// Quiet, editorial, monogrammed top. Sand glow centered behind verse.
// =========================================================================
function CenteredTemplate({
  excerpt,
  reference,
  question,
  style,
  sizing,
  format,
}: TemplateProps) {
  const pad = padFor(format);
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient colors={["#0F172A", "#0A1020"]} style={StyleSheet.absoluteFillObject} />
      <View
        style={[
          shared.glow,
          {
            top: -300,
            left: 140,
            width: 800,
            height: 800,
            borderRadius: 800,
            backgroundColor: "rgba(200,169,107,0.09)",
          },
        ]}
      />
      <LinearGradient
        colors={["transparent", "rgba(7,12,28,0.55)"]}
        style={shared.vignette}
        pointerEvents="none"
      />

      <View style={[shared.frame, { paddingHorizontal: pad.x, paddingTop: pad.top, paddingBottom: pad.bottom, alignItems: "center" }]}>
        <View style={shared.brandRow}>
          <View style={shared.brandDot} />
          <Text style={shared.brandText}>Prayers Loft</Text>
        </View>

        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", width: "100%" }}>
          <Text style={shared.styleLabel}>{style.toUpperCase()}</Text>
          <Text
            style={[
              shared.excerptText,
              {
                fontSize: sizing.fontSize,
                lineHeight: sizing.lineHeight,
                textAlign: "center",
              },
            ]}
          >
            "{excerpt}"
          </Text>
          <View style={shared.rule} />
          <Text style={shared.reference}>{reference.toUpperCase()}</Text>
        </View>

        <Text style={shared.footer}>Shared from Prayers Loft  ·  NLT</Text>
      </View>
    </View>
  );
}

// =========================================================================
// Template 2 — Reflection (Devotional alternate)
// Soft glass card with the question above, then the excerpt as a quote.
// =========================================================================
function ReflectionTemplate({
  excerpt,
  reference,
  question,
  style,
  sizing,
  format,
}: TemplateProps) {
  const pad = padFor(format);
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient colors={["#1E293B", "#0F172A", "#0A1020"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFillObject} />
      <View
        style={[
          shared.glow,
          { top: 380, right: -120, width: 700, height: 700, borderRadius: 700, backgroundColor: "rgba(200,169,107,0.07)" },
        ]}
      />
      <View
        style={[
          shared.glow,
          { top: -100, left: -120, width: 500, height: 500, borderRadius: 500, backgroundColor: "rgba(140,170,220,0.04)" },
        ]}
      />

      <View style={[shared.frame, { paddingHorizontal: pad.x, paddingTop: pad.top, paddingBottom: pad.bottom, alignItems: "center" }]}>
        <View style={shared.brandPill}>
          <View style={shared.brandDot} />
          <Text style={shared.brandPillText}>Prayers Loft</Text>
        </View>

        <View style={shared.glass}>
          <Text style={shared.kicker}>A {style.toUpperCase()} REFLECTION</Text>
          {question ? (
            <Text style={shared.question} numberOfLines={2}>
              {question}
            </Text>
          ) : null}
          <View style={shared.glassRule} />
          <Text
            style={[
              shared.excerptText,
              {
                fontSize: Math.round(sizing.fontSize * 0.92),
                lineHeight: Math.round(sizing.lineHeight * 0.95),
                textAlign: "center",
              },
            ]}
          >
            {excerpt}
          </Text>
          <Text style={shared.glassRef}>{reference}</Text>
        </View>

        <Text style={shared.footer}>Shared from Prayers Loft</Text>
      </View>
    </View>
  );
}

// =========================================================================
// Template 3 — Insight (Theologian default)
// Editorial, left-aligned with a vertical sand bar and large quote glyph.
// =========================================================================
function InsightTemplate({
  excerpt,
  reference,
  question,
  style,
  sizing,
  format,
}: TemplateProps) {
  const pad = padFor(format);
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient colors={["#0F172A", "#0A1020"]} style={StyleSheet.absoluteFillObject} />
      <View
        style={[
          shared.glow,
          { top: -180, right: -160, width: 720, height: 720, borderRadius: 720, backgroundColor: "rgba(200,169,107,0.08)" },
        ]}
      />

      <View style={[shared.frame, { paddingHorizontal: pad.x, paddingTop: pad.top, paddingBottom: pad.bottom }]}>
        <View style={shared.brandRow}>
          <View style={shared.brandDot} />
          <Text style={shared.brandText}>Prayers Loft</Text>
        </View>

        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text style={shared.insightKicker}>{style.toUpperCase()} INSIGHT</Text>
          <Text style={shared.bigQuote}>“</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 26 }}>
            <View style={shared.sideBar} />
            <Text
              style={[
                shared.excerptText,
                {
                  flex: 1,
                  fontSize: Math.round(sizing.fontSize * 0.96),
                  lineHeight: Math.round(sizing.lineHeight * 0.98),
                  textAlign: "left",
                },
              ]}
            >
              {excerpt}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 50, gap: 18 }}>
            <View style={shared.refDot} />
            <Text style={shared.referenceLeft}>{reference}</Text>
          </View>
        </View>

        <View style={shared.footerRow}>
          <Text style={shared.footer}>Shared from Prayers Loft</Text>
          <View style={shared.footerDot} />
          <Text style={shared.footer}>NLT</Text>
        </View>
      </View>
    </View>
  );
}

// =========================================================================
// Helpers + styles
// =========================================================================
type TemplateProps = {
  excerpt: string;
  reference: string;
  question?: string;
  style: "Devotional" | "Theologian";
  sizing: { fontSize: number; lineHeight: number };
  format: QAFormat;
};

function padFor(format: QAFormat) {
  if (format === "story") return { x: 110, top: 140, bottom: 130 };
  if (format === "portrait") return { x: 100, top: 110, bottom: 100 };
  return { x: 90, top: 90, bottom: 80 }; // square
}

const shared = StyleSheet.create({
  card: {
    backgroundColor: "#0F172A",
    overflow: "hidden",
  },
  glow: { position: "absolute" },
  vignette: { position: "absolute", left: 0, right: 0, bottom: 0, height: 600 },
  frame: { flex: 1, justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C8A96B" },
  brandText: {
    fontFamily: fonts.sansMedium,
    color: "rgba(248,250,252,0.72)",
    fontSize: 26,
    letterSpacing: 2,
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
  brandPillText: {
    fontFamily: fonts.sansMedium,
    color: "rgba(248,250,252,0.85)",
    fontSize: 24,
    letterSpacing: 1.8,
  },
  styleLabel: {
    fontFamily: fonts.sansMedium,
    color: "#C8A96B",
    fontSize: 22,
    letterSpacing: 5,
    marginBottom: 50,
  },
  insightKicker: {
    fontFamily: fonts.sansMedium,
    color: "#C8A96B",
    fontSize: 22,
    letterSpacing: 5,
    marginBottom: 24,
  },
  excerptText: {
    fontFamily: fonts.serif,
    color: "#F8FAFC",
    letterSpacing: 0.4,
  },
  rule: { width: 80, height: 1, backgroundColor: "rgba(200,169,107,0.55)", marginTop: 48, marginBottom: 26 },
  reference: { fontFamily: fonts.sansSemibold, color: "#C8A96B", fontSize: 26, letterSpacing: 5 },
  referenceLeft: {
    fontFamily: fonts.sansSemibold,
    color: "#C8A96B",
    fontSize: 26,
    letterSpacing: 4,
  },
  refDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#C8A96B" },
  footer: {
    fontFamily: fonts.sansMedium,
    color: "rgba(248,250,252,0.45)",
    fontSize: 22,
    letterSpacing: 2,
  },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  footerDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(248,250,252,0.3)" },
  glass: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 40,
    padding: 60,
    gap: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  kicker: { fontFamily: fonts.sansMedium, color: "#C8A96B", fontSize: 22, letterSpacing: 5 },
  question: {
    fontFamily: fonts.serifItalic,
    fontStyle: "italic",
    color: "rgba(248,250,252,0.82)",
    fontSize: 32,
    lineHeight: 44,
    textAlign: "center",
  },
  glassRule: { width: 60, height: 1, backgroundColor: "rgba(200,169,107,0.45)" },
  glassRef: { fontFamily: fonts.sansSemibold, color: "#C8A96B", fontSize: 24, letterSpacing: 3, marginTop: 4 },
  bigQuote: {
    fontFamily: fonts.serifBold,
    color: "rgba(200,169,107,0.5)",
    fontSize: 160,
    lineHeight: 120,
    marginBottom: -10,
  },
  sideBar: { width: 4, height: "100%", backgroundColor: "rgba(200,169,107,0.6)", borderRadius: 2, marginTop: 8 },
});
