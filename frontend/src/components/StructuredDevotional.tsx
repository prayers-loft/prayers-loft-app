// Shared structured-devotional renderer.
//
// Used by both:
//   • app/(tabs)/scripture.tsx       — daily verse devotional (with reference)
//   • app/(tabs)/bible-assistant.tsx — user-topic devotional (no reference passed;
//                                      the LLM bakes the verse + ref into
//                                      `key_scripture`)
//
// Visual hierarchy (top → bottom):
//   1. Card title         — large serif, semibold
//   2. KEY SCRIPTURE      — gold eyebrow + optional reference line + italic pull-quote
//   3. REFLECTION         — gold eyebrow + paragraphs (split on \n\n) with breathing room
//   4. PRACTICAL APPLICATION — gold eyebrow + single paragraph
//   5. Prayer block       — inset tinted card (accentSoft bg + 2px gold left border)
//                           with italic serif body. Line breaks preserved.
//
// Resilience: sections that are missing or whitespace-only are silently skipped,
// so the layout never shows an empty heading.

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/src/theme/theme";
import type { StructuredDevotional as StructuredDevotionalType } from "@/src/lib/daily-devotional";

export type StructuredDevotionalProps = {
  devo: StructuredDevotionalType;
  /**
   * Optional explicit verse reference shown above the pull-quote. When the
   * backend already inlines the reference into `key_scripture` (Bible Assistant),
   * leave this undefined to avoid duplication.
   */
  reference?: string;
  /** Style passthrough to override outer card spacing / margin if needed. */
  style?: object;
  testID?: string;
};

export function StructuredDevotional({ devo, reference, style, testID }: StructuredDevotionalProps) {
  const has = (s: string | undefined | null) => !!s && s.trim().length > 0;
  const reflectionParagraphs = has(devo.reflection)
    ? devo.reflection.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    : [];
  const prayerLines = has(devo.prayer)
    ? devo.prayer.split("\n").map((p) => p.trim()).filter(Boolean)
    : [];

  return (
    <View style={[styles.card, style]} testID={testID ?? "structured-devotional"}>
      {has(devo.title) && (
        <Text style={styles.title} testID="devo-title">
          {devo.title}
        </Text>
      )}

      {has(devo.key_scripture) && (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Key Scripture</Text>
          {!!reference && <Text style={styles.reference}>{reference}</Text>}
          <Text style={styles.pullQuote}>{`\u201C${devo.key_scripture}\u201D`}</Text>
        </View>
      )}

      {reflectionParagraphs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Reflection</Text>
          {reflectionParagraphs.map((p, i) => (
            <Text
              key={i}
              style={[
                styles.body,
                i < reflectionParagraphs.length - 1 && styles.bodyParagraphGap,
              ]}
            >
              {p}
            </Text>
          ))}
        </View>
      )}

      {has(devo.application) && (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Practical Application</Text>
          <Text style={styles.body}>{devo.application}</Text>
        </View>
      )}

      {prayerLines.length > 0 && (
        <View style={styles.prayerBlock} testID="devo-prayer-block">
          <Text style={[styles.eyebrow, styles.prayerEyebrow]}>Prayer</Text>
          {prayerLines.map((line, i) => (
            <Text
              key={i}
              style={[
                styles.prayerLine,
                i === prayerLines.length - 1 && styles.prayerLineLast,
              ]}
            >
              {line}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 20,
    padding: 24,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 22,
    lineHeight: 30,
    color: colors.text,
    fontWeight: "600",
    letterSpacing: -0.1,
    marginBottom: 18,
  },
  section: {
    marginBottom: 20,
  },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  reference: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  pullQuote: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 16,
    lineHeight: 26,
    color: colors.warmHighlight,
  },
  body: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 28,
    color: colors.text,
  },
  bodyParagraphGap: {
    marginBottom: 14,
  },
  prayerBlock: {
    backgroundColor: colors.accentSoft,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 4,
  },
  prayerEyebrow: {
    marginBottom: 10,
  },
  prayerLine: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 15,
    lineHeight: 24,
    color: colors.warmHighlight,
    marginBottom: 4,
  },
  prayerLineLast: {
    marginBottom: 0,
  },
});
