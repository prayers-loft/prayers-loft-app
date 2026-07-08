// -----------------------------------------------------------------------------
// GuestSoftBanner — the quiet "Save your spiritual journey" nudge shown at
// the top of the Prayer home screen ONLY for anonymous / local-only users.
//
// VISIBILITY CONTRACT (Build 16 fix)
// ----------------------------------
// The banner used to be storage-driven only (14-day dismiss window), which
// meant signed-in Google users still saw the "Keep My Journey Safe" upsell
// on every cold launch — confusing UX because their journey IS already
// saved. This component now also gates on auth state:
//
//   • ready === false (initial auth restore in flight) → render NOTHING.
//     Prevents the banner from flashing for a signed-in user during the
//     ~200ms it takes readPersisted() to hydrate.
//   • ready === true AND user != null (signed in) → render NOTHING.
//     No upsell for users who've already opted in.
//   • ready === true AND user == null (confirmed anonymous) → render
//     the banner IF the 14-day dismiss window has not fired.
//
// The auth gate is intentionally UNIT-testable via the exported
// shouldRenderGuestSoftBanner() helper so a copy or condition regression
// gets caught in CI. See tests/tests/unit-guest-soft-banner.spec.ts.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "@/src/utils/storage";
import { colors, fonts } from "@/src/theme/theme";
import { forceUpgradePrompt } from "@/src/components/UpgradePromptHost";
import { track } from "@/src/lib/analytics";
import { useAuthState } from "@/src/hooks/use-auth-state";
import { shouldRenderGuestSoftBanner } from "@/src/lib/guest-soft-banner-visibility";

// Re-export the pure predicate so callers that already import from this
// module (and tests, in principle) keep working. New tests should import
// directly from src/lib/guest-soft-banner-visibility to stay Node-safe.
export { shouldRenderGuestSoftBanner };

const KEY = "prayersloft_softbanner_dismissed_at";

/** Pure predicate — decides whether the banner should render given the
 *  three inputs. Lives in src/lib/guest-soft-banner-visibility.ts so it
 *  is Node-safe for unit tests. Re-exported above for convenience. */

export function GuestSoftBanner() {
  const auth = useAuthState();
  // The dismissed-at ISO string once we've read it from storage. Empty
  // string means "never dismissed"; `null` means "we haven't read yet".
  // Kept nullable so we don't render the banner in the split-second
  // before storage returns, even for confirmed anonymous users.
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await storage.getItem(KEY, "");
      if (!cancelled) setDismissedAt(String(raw ?? ""));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = async () => {
    track("upgrade_prompt_dismissed", { trigger_source: "guest_soft_banner" });
    const iso = new Date().toISOString();
    await storage.setItem(KEY, iso);
    setDismissedAt(iso);
  };

  const tap = () => {
    forceUpgradePrompt("guest_soft_banner");
  };

  // Full render gate. All three signals must line up before we show.
  // Storage read pending → also hide (prevents a brief flash before
  // dismissedAt resolves for anonymous users who dismissed recently).
  const signedIn = !!auth.user;
  const storageReady = dismissedAt !== null;
  if (!storageReady) return null;
  if (!shouldRenderGuestSoftBanner(auth.ready, signedIn, dismissedAt)) {
    return null;
  }

  return (
    <View style={styles.wrap} testID="guest-soft-banner">
      <Pressable
        onPress={tap}
        style={styles.body}
        accessibilityRole="button"
        accessibilityLabel="Save your spiritual journey"
        testID="guest-soft-banner-cta"
      >
        <View style={styles.iconDot}>
          <Ionicons name="cloud-upload-outline" size={14} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Save your spiritual journey</Text>
          <Text style={styles.sub}>Keep My Journey Safe</Text>
        </View>
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={10} style={styles.closeBtn} testID="guest-soft-banner-dismiss">
        <Ionicons name="close" size={14} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  iconDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(200,169,107,0.12)",
    borderWidth: 1, borderColor: "rgba(200,169,107,0.25)",
  },
  title: { fontFamily: fonts.sansSemibold, color: colors.text, fontSize: 13.5, letterSpacing: 0.1 },
  sub: { fontFamily: fonts.sansMedium, color: colors.accent, fontSize: 12, marginTop: 1, letterSpacing: 0.2 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
});
