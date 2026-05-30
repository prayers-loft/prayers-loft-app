// Dismissible soft banner for Guest users, surfaced at the top of the Prayer
// home screen. Quiet, non-blocking, one-tap dismissal that sticks for 14d.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "@/src/utils/storage";
import { colors, fonts } from "@/src/theme/theme";
import { forceUpgradePrompt } from "@/src/components/UpgradePromptHost";
import { track } from "@/src/lib/analytics";

const KEY = "prayersloft_softbanner_dismissed_at";
const SUPPRESS_FOR_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function GuestSoftBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await storage.getItem(KEY, "");
      if (!raw) {
        setShow(true);
        return;
      }
      const at = new Date(String(raw)).getTime();
      if (Number.isFinite(at) && Date.now() - at > SUPPRESS_FOR_MS) setShow(true);
    })();
  }, []);

  const dismiss = async () => {
    track("upgrade_prompt_dismissed", { trigger_source: "guest_soft_banner" });
    await storage.setItem(KEY, new Date().toISOString());
    setShow(false);
  };

  const tap = () => {
    forceUpgradePrompt("guest_soft_banner");
  };

  if (!show) return null;

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
          <Text style={styles.sub}>Backup My Journey</Text>
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
