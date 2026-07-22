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
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, fonts, spacing, radii } from "@/src/theme/theme";
import { listMemory, MemoryItem, getWalkLanding } from "@/src/lib/walk-api";

// Android needs an explicit opt-in for LayoutAnimation. iOS + Web work
// out of the box. Doing this once at module load is safe — the flag is
// idempotent.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
            <Text style={styles.beginText} allowFontScaling={false}>
              {landing?.is_first_ever === false ? "Continue" : "Begin"}
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

            {/* Manage Walk Memory — quiet outline pill sits directly under the
                memory ledger. Only shown when the user actually has at least
                one saved item, so first-time users aren't offered a Manage
                screen for an empty list. Screen it opens (walk-memory.tsx)
                handles its own empty state for the edge case where all items
                get deleted between renders. */}
            {(memory ?? []).length > 0 && (
              <Pressable
                onPress={() => router.push("/walk-memory" as any)}
                style={({ pressed }) => [
                  styles.manageBtn,
                  pressed && styles.manageBtnPressed,
                ]}
                testID="walk-manage-memory-btn"
                accessibilityRole="button"
                accessibilityLabel="Manage Walk memory"
              >
                <Ionicons
                  name="settings-outline"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text style={styles.manageBtnText}>Manage Walk Memory</Text>
              </Pressable>
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

// Show at most this many items when a Section is collapsed. Anything
// beyond this is hidden behind a real Pressable that expands the list
// with a smooth layout animation — never a dead "+N more" affordance.
const COLLAPSED_ITEM_LIMIT = 3;

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
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, items.length - COLLAPSED_ITEM_LIMIT);
  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_ITEM_LIMIT);
  const canExpand = hidden > 0;

  const toggle = useCallback(() => {
    // Keep the animation short and gentle so the section doesn't feel
    // jumpy — this is a memory ledger, not a UI toy.
    LayoutAnimation.configureNext({
      duration: 220,
      create: { type: "easeInEaseOut", property: "opacity" },
      update: { type: "easeInEaseOut" },
      delete: { type: "easeInEaseOut", property: "opacity" },
    });
    setExpanded((prev) => !prev);
  }, []);

  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {visibleItems.map((m) => (
        <View key={m.id} style={styles.memoryCard}>
          <Text style={styles.memoryText}>{m.content}</Text>
          {m.scripture_ref ? (
            <Text style={styles.memoryRef}>{m.scripture_ref}</Text>
          ) : null}
        </View>
      ))}
      {canExpand ? (
        <Pressable
          onPress={toggle}
          hitSlop={12}
          style={({ pressed }) => [
            styles.expandBtn,
            pressed && styles.expandBtnPressed,
          ]}
          testID={`${testID}-toggle`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            expanded
              ? `Show fewer ${title.toLowerCase()} entries`
              : `View ${hidden} more ${title.toLowerCase()} ${
                  hidden === 1 ? "entry" : "entries"
                }`
          }
        >
          <Text style={styles.expandBtnText}>
            {expanded ? "Show fewer" : `View ${hidden} more`}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.textSecondary}
          />
        </Pressable>
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
    // Pill hugs its intrinsic content so the text can never be constrained
    // by a parent-row layout. This eliminates the ellipsis class of bug
    // entirely — there is no flex context on the label.
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    // Fixed, comfortable label ↔ arrow gap.
    gap: 10,
    // Reduced ~20% from the previous 14 so the CTA feels lighter but the
    // 44pt iOS tap target is preserved via minHeight.
    paddingVertical: 11,
    paddingHorizontal: 22,
    minHeight: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  beginText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.bg,
    letterSpacing: 0.3,
    // Never allow the text to shrink or wrap — the button already hugs
    // its content so this is the belt to alignSelf's braces.
    flexShrink: 0,
    includeFontPadding: false,
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
  expandBtn: {
    // Section-scoped expand/collapse control. Sits below the last
    // visible memory card as a quiet, self-explanatory pill. Keeps a
    // 44pt tap target via minHeight + generous hitSlop, matches the
    // muted "Sitting with"/"Carrying forward" section aesthetic, and
    // never blocks a card behind an obscure "+N more" hint again.
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  expandBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  expandBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  // "Manage Walk Memory" outline pill — quiet, secondary action so it
  // doesn't compete visually with the primary Begin/Continue CTA at the
  // top of the screen. Sits under the memory sections as the natural
  // next step when the user is looking at their ledger and thinks
  // "I want to prune this."
  manageBtn: {
    marginTop: spacing.xl,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: radii.pill,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  manageBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  manageBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
    letterSpacing: 0.2,
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
