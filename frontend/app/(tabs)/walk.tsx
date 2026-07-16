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
import { listMemory, MemoryItem } from "@/src/lib/walk-api";

export default function WalkScreen() {
  const router = useRouter();
  const [memory, setMemory] = useState<MemoryItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listMemory({ status: "active" });
      setMemory(res.items);
    } catch {
      setMemory([]);
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
  const isReturning = (memory?.length ?? 0) > 0;

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
            {isReturning ? "Welcome back" : "Welcome"}
          </Text>
          <Text style={styles.heroTitle}>
            {isReturning
              ? "Ready to check in?"
              : "How is your walk with God?"}
          </Text>
          <Text style={styles.heroBody}>
            Take your time. There is nothing to prove here — just a conversation
            you can have when you want it.
          </Text>
          <Pressable
            onPress={() => router.push("/walk-conversation" as any)}
            style={styles.beginBtn}
            testID="walk-begin-checkin"
            accessibilityRole="button"
          >
            <Text style={styles.beginText}>Begin check-in</Text>
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
                title="You said you'd…"
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
  beginBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
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
