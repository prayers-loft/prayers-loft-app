// -----------------------------------------------------------------------------
// Walk Memory — management screen.
//
// Single responsibility (Build 26B UX ticket): let the user see every active
// item they've saved to their Walk memory and remove any they no longer want.
// This is a MANAGEMENT primitive, not a creation one — extraction happens
// server-side during a Walk session (see backend walk.py); this screen is
// strictly read + delete.
//
// Contract:
//   • Frontend-only. Uses existing endpoints:
//       GET  /api/walk/memory        via listMemory({ status: "active" })
//       DELETE /api/walk/memory/{id} via deleteMemory(id)
//   • No editing, no status changes, no swipe gestures, no new backend calls,
//     no LLM calls. Deletion never affects the historical Walk transcript.
//   • Empty state and error state are both handled so the screen is never
//     silently blank.
//
// Ordering: memory items are grouped by kind (commitments, struggles, prayers,
// lessons) in that fixed order — this matches the priority ordering the
// Walk-tab landing hero already uses (Carrying forward → Sitting with →
// Praying about) so the mental model stays consistent between screens.
// Within a group, most-recently-updated first (backend already returns them
// in updated_at desc via listMemory's default sort).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { colors, fonts, radii, spacing } from "@/src/theme/theme";
import { showToast } from "@/src/components/Toast";
import {
  deleteMemory,
  listMemory,
  MemoryItem,
  MemoryKind,
} from "@/src/lib/walk-api";

// Display order matches the Walk-tab landing sections + adds "Lessons" which
// the landing screen currently omits. Keeping "commitment" first mirrors the
// hero's "Carrying forward" emphasis on active promises.
const GROUP_ORDER: { kind: MemoryKind; title: string }[] = [
  { kind: "commitment", title: "Commitments" },
  { kind: "struggle", title: "Struggles" },
  { kind: "prayer", title: "Prayers" },
  { kind: "lesson", title: "Lessons" },
];

export default function WalkMemoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `null` = still loading (first fetch not yet complete). `[]` = loaded,
  // empty. This tri-state avoids flashing the empty-state copy while the
  // request is in flight.
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ids currently mid-delete. Rendered with reduced opacity + disabled
  // controls so the user can't double-tap and race two DELETEs.
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await listMemory({ status: "active" });
      setItems(res.items);
    } catch {
      setError("We couldn't load your Walk memory just now. Pull down to retry.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh on focus so a delete performed on this screen, or a save that
  // happened in a session between visits, is always reflected immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Group memories by kind. Memoized against `items` so the group buckets
  // don't rebuild on every keystroke of an unrelated state change.
  const grouped = useMemo(() => {
    const map = new Map<MemoryKind, MemoryItem[]>();
    for (const m of items ?? []) {
      if (!map.has(m.kind)) map.set(m.kind, []);
      map.get(m.kind)!.push(m);
    }
    return map;
  }, [items]);

  const isLoading = items === null;
  const isEmpty = items !== null && items.length === 0;

  const confirmAndDelete = useCallback(
    (mem: MemoryItem) => {
      // Native confirmation.
      //   • iOS / Android: Alert.alert renders a proper multi-button system
      //     dialog — the right idiom for an irreversible destructive action.
      //   • Web (Metro preview + expo web builds): RN Web's Alert.alert only
      //     supports the single-button window.alert path and swallows the
      //     Cancel/Remove buttons entirely, which would make deletion silent
      //     and unreachable. Fall back to window.confirm which returns a
      //     synchronous boolean and gives us the same yes/no gate.
      const title = "Remove this from your Walk memory?";

      const runDelete = async () => {
        // Optimistic-ish: mark this row as deleting so it dims and its
        // trash icon disables. On success we splice it out. On failure
        // we un-dim and toast the error — the row snaps back to normal
        // so the user knows nothing changed.
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.add(mem.id);
          return next;
        });
        try {
          await deleteMemory(mem.id);
          setItems((prev) => (prev ?? []).filter((x) => x.id !== mem.id));
          showToast({
            message: "Removed from your Walk memory.",
            variant: "success",
          });
        } catch {
          showToast({
            message: "Couldn't remove that just now. Please try again.",
            variant: "error",
          });
        } finally {
          setDeletingIds((prev) => {
            const next = new Set(prev);
            next.delete(mem.id);
            return next;
          });
        }
      };

      if (Platform.OS === "web") {
        // window.confirm is available on RN Web through the global object.
        // Guard for the SSR-render case where `window` may not exist.
        const w =
          typeof globalThis !== "undefined"
            ? (globalThis as { confirm?: (m: string) => boolean }).confirm
            : undefined;
        if (w && w(title)) {
          void runDelete();
        }
        return;
      }

      Alert.alert(title, undefined, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void runDelete();
          },
        },
      ]);
    },
    [],
  );

  return (
    <ScreenBackground>
      <View style={[styles.headerRow, { paddingTop: insets.top + 14 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          testID="walk-memory-back-button"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Walk Memory</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        testID="walk-memory-scroll"
      >
        <Text style={styles.introBody}>
          These are the items your companion is holding onto from past
          conversations. Remove anything you no longer want to carry.
        </Text>

        {isLoading ? (
          <View style={styles.centerBlock} testID="walk-memory-loading">
            <ActivityIndicator color={colors.textTertiary} />
          </View>
        ) : isEmpty ? (
          <View style={styles.centerBlock} testID="walk-memory-empty">
            <Ionicons
              name="leaf-outline"
              size={36}
              color={colors.textTertiary}
            />
            <Text style={styles.emptyText}>
              Nothing has been saved to your Walk memory yet.
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        ) : (
          <View style={{ gap: spacing.xl, marginTop: spacing.lg }}>
            {GROUP_ORDER.map(({ kind, title }) => {
              const rows = grouped.get(kind) ?? [];
              if (rows.length === 0) return null;
              return (
                <View
                  key={kind}
                  style={styles.group}
                  testID={`walk-memory-group-${kind}`}
                >
                  <Text style={styles.groupTitle}>{title}</Text>
                  {rows.map((m) => {
                    const isDeleting = deletingIds.has(m.id);
                    return (
                      <View
                        key={m.id}
                        style={[
                          styles.memoryCard,
                          isDeleting && styles.memoryCardDeleting,
                        ]}
                        testID={`walk-memory-item-${m.id}`}
                      >
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={styles.memoryText}>{m.content}</Text>
                          {m.scripture_ref ? (
                            <Text style={styles.memoryRef}>
                              {m.scripture_ref}
                            </Text>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() => confirmAndDelete(m)}
                          disabled={isDeleting}
                          hitSlop={12}
                          style={({ pressed }) => [
                            styles.deleteBtn,
                            pressed && styles.deleteBtnPressed,
                          ]}
                          testID={`walk-memory-delete-${m.id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove this ${title
                            .toLowerCase()
                            .replace(/s$/, "")} from Walk memory`}
                        >
                          {isDeleting ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.textSecondary}
                            />
                          ) : (
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color={colors.textSecondary}
                            />
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  introBody: {
    fontFamily: fonts.sansRegular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  centerBlock: {
    marginTop: spacing.xxl,
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  emptyText: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 300,
  },
  errorText: {
    fontFamily: fonts.sansRegular,
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: "center",
  },
  group: {
    gap: spacing.sm,
  },
  groupTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.textTertiary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  memoryCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  memoryCardDeleting: {
    opacity: 0.5,
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
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  deleteBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.10)",
  },
});
