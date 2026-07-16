// -----------------------------------------------------------------------------
// Walk tab — the entry point for the discipleship companion.
//
// The tab is intentionally quiet: a short header, a welcome card, and a
// single "Begin check-in" pressable. Recent commitments (if any) surface
// below as gentle reminders — never a task list, never a score.
//
// The conversation itself opens on a separate stack route (/walk-conversation)
// so the tab bar doesn't crowd a full-screen chat.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, fonts, spacing, radii } from "@/src/theme/theme";
import { listMemory, MemoryItem, getWalkLanding } from "@/src/lib/walk-api";

type LandingInfo = {
  is_first_ever: boolean;
  session_count: number;
  last_session_summary: string | null;
  callback_hint: string | null;
};

export default function WalkScreen() {
  const router = useRouter();
  const [memory, setMemory] = useState<MemoryItem[] | null>(null);
  const [landing, setLanding] = useState<LandingInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mem, land] = await Promise.all([
        listMemory({ status: "active" }),
        getWalkLanding(),
      ]);
      setMemory(mem.items);
      setLanding({
        is_first_ever: land.is_first_ever,
        session_count: land.session_count,
        last_session_summary: land.last_session_summary,
        callback_hint: land.callback_hint,
      });
    } catch {
      setMemory([]);
      setLanding(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reload when the tab regains focus so commitments made in a session that
  // just ended appear immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const activeCommitments =
    memory?.filter((m) => m.kind === "commitment" && m.status === "active") ?? [];
  const activeStruggles =
    memory?.filter((m) => m.kind === "struggle" && m.status === "active") ?? [];
  const activePrayers =
    memory?.filter((m) => m.kind === "prayer" && m.status === "active") ?? [];

  return (
    <ScreenBackground>
      <ScreenHeader title="Walk" subtitle="A quiet moment together" />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textTertiary}
          />
        }
      >
        <View style={styles.hero} testID="walk-hero">
          <Text style={styles.heroEyebrow}>
            {landing?.is_first_ever === false ? "Welcome back" : "Welcome"}
          </Text>
          <Text style={styles.heroPurpose}>Continue your journey with Christ.</Text>
          <Text style={styles.heroTitle}>
            {landing?.is_first_ever === false
              ? "How are you doing today?"
              : "How is your walk with God?"}
          </Text>
          {landing?.callback_hint ? (
            <Text style={styles.heroCallback} testID="walk-callback-hint">
              {landing.callback_hint.trim().replace(/[.!?]?$/, ".")}
            </Text>
          ) : null}
          <Text style={styles.heroBody}>
            {landing?.is_first_ever === false
              ? "It's good to continue where we left off. Whenever you're ready."
              : "Take your time. There is nothing to prove here — just a conversation you can have when you want it."}
          </Text>
          <Pressable
            onPress={() => router.push("/walk-conversation" as any)}
            style={styles.beginBtn}
            testID="walk-begin-checkin"
            accessibilityRole="button"
            accessibilityLabel={
              landing?.is_first_ever === false
                ? "Continue your walk"
                : "Begin your walk"
            }
          >
            <Text
              style={styles.beginText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.9}
              allowFontScaling={false}
            >
              {landing?.is_first_ever === false
                ? "Continue your walk"
                : "Begin your walk"}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={colors.bg} />
          </Pressable>
        </View>

        {memory === null ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.textTertiary} />
          </View>
        ) : (
          <>
            {activeCommitments.length > 0 && (
              <Section
                title="Carrying forward"
                items={activeCommitments}
                emptyText=""
                testID="walk-active-commitments"
              />
            )}
            {activeStruggles.length > 0 && (
              <Section
                title="Sitting with"
                items={activeStruggles}
                emptyText=""
                testID="walk-active-struggles"
              />
            )}
            {activePrayers.length > 0 && (
              <Section
                title="Praying about"
                items={activePrayers}
                emptyText=""
                testID="walk-active-prayers"
              />
            )}
          </>
        )}

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            A companion, not a pastor. Not a replacement for your church or a
            person you trust.
          </Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

function Section({
  title,
  items,
  testID,
}: {
  title: string;
  items: MemoryItem[];
  emptyText: string;
  testID: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.slice(0, 3).map((m) => (
        <View key={m.id} style={styles.memoryCard}>
          <Text style={styles.memoryText}>{m.content}</Text>
          {m.scripture_ref ? (
            <Text style={styles.memoryRef}>{m.scripture_ref}</Text>
          ) : null}
        </View>
      ))}
      {items.length > 3 ? (
        <Text style={styles.moreHint}>+{items.length - 3} more</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  hero: {
    backgroundColor: colors.surface1,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  heroEyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  heroPurpose: {
    fontFamily: fonts.sansRegular,
    fontSize: 13,
    color: colors.textTertiary,
    letterSpacing: 0.4,
    marginTop: -8,
    marginBottom: 4,
  },
  heroTitle: {
    fontFamily: fonts.serif,
    fontSize: 28,
    lineHeight: 34,
    color: colors.textPrimary,
  },
  heroBody: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  heroCallback: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
    fontStyle: "italic",
    marginTop: 4,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  beginBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    // Reduced ~20% (was 14) so the CTA feels lighter and stays on a single
    // line even on narrow devices. Horizontal padding keeps the shape
    // proportional and gives the text room to breathe.
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    minHeight: 44, // preserves the iOS-recommended tap target
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  beginText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.bg,
    letterSpacing: 0.3,
  },
  loadingCard: {
    marginTop: spacing.xl,
    alignItems: "center",
    padding: spacing.xl,
  },
  section: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.textTertiary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  memoryCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
    gap: 4,
  },
  memoryText: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  memoryRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  moreHint: {
    fontFamily: fonts.sansRegular,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
    textAlign: "center",
  },
  footerNote: {
    marginTop: spacing.xl,
    padding: spacing.md,
    alignItems: "center",
  },
  footerText: {
    fontFamily: fonts.sansRegular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textTertiary,
    textAlign: "center",
    fontStyle: "italic",
    maxWidth: 320,
  },
});
