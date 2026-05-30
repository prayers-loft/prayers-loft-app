// Settings screen — the calm, low-friction home for Guest Mode controls
// and the (Phase 2) account-upgrade path.
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenBackground } from "@/src/components/ScreenBackground";
import { colors, fonts } from "@/src/theme/theme";
import { getGuestIdentity } from "@/src/lib/guest-identity";
import { DEFAULT_PREFS, getPrefs, updatePrefs, Preferences } from "@/src/lib/local-prefs";
import { exportGuestData, wipeAllGuestData } from "@/src/lib/data-export";
import { ConversionTrigger, track } from "@/src/lib/analytics";
import { forceUpgradePrompt } from "@/src/components/UpgradePromptHost";

function shortJoinedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return "recently";
  }
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [guest, setGuest] = useState<{ id: string; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [p, g] = await Promise.all([getPrefs(), getGuestIdentity()]);
      setPrefs(p);
      setGuest(g);
      setLoading(false);
      track(ConversionTrigger.SettingsOpened);
    })();
  }, []);

  const pop = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const onTogglePref = async <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    const next = await updatePrefs({ [key]: value } as Partial<Preferences>);
    setPrefs(next);
  };

  const handleCreateAccount = () => {
    track(ConversionTrigger.ManualUpgradeTap, { source: "settings" });
    forceUpgradePrompt("settings_backup_button");
  };

  const handleExport = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const result = await exportGuestData();
      if (result === "failed") pop("Couldn't export your data");
      else if (result === "copied") pop("Backup copied to clipboard");
      else if (result === "downloaded") pop("Backup downloaded");
      else pop("Backup ready to share");
    } finally {
      setExportBusy(false);
    }
  };

  const handleWipe = () => {
    Alert.alert(
      "Erase local data?",
      "This removes your saved prayers, preferences, and cached devotional from this device. Server-stored reflections are unaffected. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Erase",
          style: "destructive",
          onPress: async () => {
            await wipeAllGuestData();
            pop("Local data erased");
            const fresh = await getPrefs();
            setPrefs(fresh);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={[styles.loading, { paddingTop: insets.top + 80 }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <View style={[styles.headerRow, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="settings-back-button">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- ACCOUNT ---- */}
        <Section label="Account">
          <View style={styles.heroCard} testID="guest-card">
            <View style={styles.heroIconRing}>
              <Ionicons name="leaf-outline" size={20} color={colors.accent} />
            </View>
            <Text style={styles.heroTitle}>Using Prayers Loft as Guest</Text>
            <Text style={styles.heroSub}>
              Joined {guest ? shortJoinedDate(guest.createdAt) : "recently"}
            </Text>
            <View style={styles.benefitList}>
              <Benefit text="Sync your prayers across devices" />
              <Benefit text="Protect your reflections and streaks" />
              <Benefit text="Save your spiritual journey" />
            </View>
            <Pressable
              onPress={handleCreateAccount}
              style={styles.primaryBtn}
              testID="create-account-button"
            >
              <Text style={styles.primaryBtnText}>Backup My Journey</Text>
            </Pressable>
            <Text style={styles.tinyNote}>You can always continue as a guest.</Text>
          </View>
        </Section>

        {/* ---- NOTIFICATIONS ---- */}
        <Section label="Notifications">
          <Row
            title="Daily reminder"
            subtitle="A gentle nudge to pause and pray"
            right={
              <Switch
                value={prefs.notificationsEnabled}
                onValueChange={(v) => onTogglePref("notificationsEnabled", v)}
                trackColor={{ true: colors.accent, false: "#33405A" }}
                thumbColor="#F8FAFC"
              />
            }
          />
          <Row
            title="Reminder time"
            subtitle={prefs.notificationsDailyTime + " · device local time"}
            disabled={!prefs.notificationsEnabled}
          />
        </Section>

        {/* ---- APPEARANCE ---- */}
        <Section label="Appearance">
          <Row
            title="Ambient sound on by default"
            subtitle="Soft background tones during prayer"
            right={
              <Switch
                value={prefs.ambientDefaultOn}
                onValueChange={(v) => onTogglePref("ambientDefaultOn", v)}
                trackColor={{ true: colors.accent, false: "#33405A" }}
                thumbColor="#F8FAFC"
              />
            }
          />
        </Section>

        {/* ---- DATA & SYNC ---- */}
        <Section label="Data & Sync">
          <Row
            title="Export backup"
            subtitle="Save your spiritual journey as a JSON file"
            onPress={handleExport}
            right={exportBusy ? <ActivityIndicator color={colors.accent} /> : <Chev />}
            testID="export-backup-button"
          />
          <Row
            title="Cloud sync"
            subtitle="Available when you create an account"
            disabled
            right={<Text style={styles.locked}>Soon</Text>}
          />
        </Section>

        {/* ---- PRIVACY ---- */}
        <Section label="Privacy">
          <Row
            title="Improve Prayers Loft"
            subtitle="Share anonymous usage signals"
            right={
              <Switch
                value={prefs.analyticsOptIn}
                onValueChange={(v) => onTogglePref("analyticsOptIn", v)}
                trackColor={{ true: colors.accent, false: "#33405A" }}
                thumbColor="#F8FAFC"
              />
            }
          />
          <Row
            title="Erase local data"
            subtitle="Reset this device. Cannot be undone."
            onPress={handleWipe}
            danger
            right={<Chev tone="danger" />}
            testID="wipe-data-button"
          />
        </Section>

        {/* ---- ABOUT ---- */}
        <Section label="About">
          <Row title="Prayers Loft" subtitle={`Guest · ${Platform.OS}`} />
          <Row title="Made with care" subtitle="A quiet place to pray, reflect, and remember." />
        </Section>
      </ScrollView>

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </ScreenBackground>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
      <View style={styles.sectionInner}>{children}</View>
    </View>
  );
}

function Row({
  title,
  subtitle,
  right,
  onPress,
  disabled,
  danger,
  testID,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const content = (
    <View style={[styles.row, disabled && { opacity: 0.5 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && { color: "#F2A8A8" }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {right ?? null}
    </View>
  );
  if (onPress && !disabled) {
    return (
      <Pressable onPress={onPress} testID={testID} android_ripple={{ color: "rgba(255,255,255,0.05)" }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

function Benefit({ text }: { text: string }) {
  return (
    <View style={styles.benefitRow}>
      <Ionicons name="checkmark" size={14} color={colors.accent} />
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

function Chev({ tone }: { tone?: "danger" }) {
  return <Ionicons name="chevron-forward" size={18} color={tone === "danger" ? "#F2A8A8" : colors.textTertiary} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface1,
  },
  headerTitle: { fontFamily: fonts.sansSemibold, fontSize: 16, color: colors.text, letterSpacing: 0.2 },
  scroll: { paddingHorizontal: 20, paddingTop: 6, gap: 22 },

  section: { gap: 10 },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    letterSpacing: 2,
    color: colors.textTertiary,
    marginTop: 6,
    marginLeft: 6,
  },
  sectionInner: {
    backgroundColor: colors.surface1,
    borderRadius: 18,
    overflow: "hidden",
  },

  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  rowTitle: { fontFamily: fonts.sansMedium, color: colors.text, fontSize: 14.5 },
  rowSub: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },

  // hero account card
  heroCard: {
    padding: 22,
    gap: 12,
    alignItems: "flex-start",
  },
  heroIconRing: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.3)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  heroTitle: { fontFamily: fonts.sansSemibold, fontSize: 18, color: colors.text, letterSpacing: -0.2, marginTop: 4 },
  heroSub: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 13 },
  benefitList: { gap: 8, marginTop: 6, marginBottom: 4 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  benefitText: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: 8,
  },
  primaryBtnText: { fontFamily: fonts.sansSemibold, color: colors.textOnAccent, fontSize: 14.5 },
  tinyNote: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 11.5, marginTop: 4 },

  locked: { fontFamily: fonts.sansMedium, color: colors.textTertiary, fontSize: 12 },

  toast: {
    position: "absolute",
    bottom: 30,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  toastText: { fontFamily: fonts.sansMedium, color: colors.text, fontSize: 13 },
});
