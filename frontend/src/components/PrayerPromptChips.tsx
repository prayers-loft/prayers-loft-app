// Rotating, tappable prompt chips beneath the prayer input.
// Reduces blank-page paralysis on first-prayer completion.
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/src/theme/theme";

const CHIPS = [
  "Peace before a difficult conversation",
  "Gratitude for today",
  "Guidance on a decision",
  "Healing for someone I love",
  "Comfort in a season of waiting",
  "Strength through anxious thoughts",
  "Wisdom for a relationship",
  "Renewal when I'm weary",
];

function pickThree(seedSource: number): string[] {
  // Deterministic rotation based on hour of day so the set changes through the
  // day without flicker on re-render. No API calls; pure client.
  const ordered = [...CHIPS];
  const start = seedSource % CHIPS.length;
  return [
    ordered[start % CHIPS.length],
    ordered[(start + 3) % CHIPS.length],
    ordered[(start + 5) % CHIPS.length],
    ordered[(start + 7) % CHIPS.length],
  ];
}

export function PrayerPromptChips({
  onPick,
  visible = true,
}: {
  onPick: (text: string) => void;
  visible?: boolean;
}) {
  const seed = useMemo(() => {
    const d = new Date();
    return d.getHours() * 7 + d.getDate();
  }, []);
  const chips = useMemo(() => pickThree(seed), [seed]);
  if (!visible) return null;
  return (
    <View style={styles.wrap} testID="prayer-prompt-chips">
      <Text style={styles.label}>Try one of these</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {chips.map((c) => (
          <Pressable
            key={c}
            onPress={() => onPick(c)}
            style={styles.chip}
            testID={`prayer-chip-${c.replace(/\s+/g, "-").toLowerCase()}`}
            accessibilityRole="button"
            accessibilityLabel={`Use prompt: ${c}`}
          >
            <Text style={styles.chipText}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.textTertiary,
    textTransform: "uppercase",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  row: { paddingHorizontal: 2, paddingRight: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.28)",
    backgroundColor: "rgba(200,169,107,0.06)",
    marginRight: 8,
  },
  chipText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text,
  },
});
