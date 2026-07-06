// -----------------------------------------------------------------------------
// EmptyState — reusable component for "no content yet" and "load failed"
// screens.
//
// WHY THIS FILE EXISTS
// --------------------
// Empty-state cards used to be inlined in every screen file (My Journal,
// Bible Assistant, Scripture) and had drifted visually — different
// backgrounds, different paddings, different button pill styles. This
// component pins the visual contract in one place so any future empty
// state (saved audio prayers, verse plans, etc.) drops in identically.
//
// Two visual variants:
//   • "info"  — default. Neutral card, dim icon. Used for "no data yet".
//   • "error" — warmer tone; still non-alarming. Used when content
//                failed to load. Distinguishes UX from success-empty so
//                the user doesn't think their data was wiped.
//
// The styling MATCHES the existing Journal empty card (surface1 bg, 36px
// vertical padding, 22px radius, gold-pill CTA) so wiring it into
// reflections-history is truly a drop-in, no pixel drift.
// -----------------------------------------------------------------------------
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";

export type EmptyStateVariant = "info" | "error";

export type EmptyStateAction = {
  label: string;
  onPress: () => void;
  testID?: string;
  /** Show a spinner in place of the label — the CTA stays visible so the
   *  user knows something is happening on tap. */
  loading?: boolean;
  /** Disables tap. Loading implies disabled. */
  disabled?: boolean;
};

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** Secondary line — often a soft "how to" nudge under the body. */
  hint?: string;
  action?: EmptyStateAction;
  variant?: EmptyStateVariant;
  testID?: string;
};

export function EmptyState({
  icon,
  title,
  body,
  hint,
  action,
  variant = "info",
  testID,
}: Props) {
  const disabled = !!(action && (action.disabled || action.loading));
  return (
    <View
      style={[styles.card, variant === "error" && styles.cardError]}
      testID={testID}
    >
      <Ionicons
        name={icon}
        size={28}
        color={variant === "error" ? colors.accent : colors.textTertiary}
      />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={disabled}
          style={({ pressed }) => [
            styles.cta,
            pressed && !disabled && { opacity: 0.85 },
            disabled && styles.ctaDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled }}
          testID={action.testID}
          hitSlop={6}
        >
          {action.loading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <>
              <Text style={styles.ctaText}>{action.label}</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent} />
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Aligned exactly to the existing reflections-history .emptyCard so the
  // drop-in refactor doesn't shift visuals by a pixel.
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 22,
    padding: 36,
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  // Warm border on the error variant — enough to signal "different"
  // without dumping a red danger banner on the page.
  cardError: {
    borderColor: "rgba(200, 169, 107, 0.28)",
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  body: {
    fontFamily: fonts.serif,
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 23,
  },
  hint: {
    fontFamily: fonts.sans,
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 2,
  },
  cta: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
    // Ensures the tap target hits the 44pt minimum even with the tight
    // vertical padding of the existing design.
    minHeight: 40,
    minWidth: 140,
    justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: {
    fontFamily: fonts.sansMedium,
    color: colors.accent,
    fontSize: 13,
    letterSpacing: 0.2,
  },
});
