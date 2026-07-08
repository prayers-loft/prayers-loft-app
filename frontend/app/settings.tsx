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
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
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
import { useAuthState } from "@/src/hooks/use-auth-state";
import { logout, deleteAccount } from "@/src/lib/auth-api";
import { replayOnboarding } from "@/src/lib/onboarding";
import { showToast } from "@/src/components/Toast";
import {
  cancelAllDailyReminders,
  ensureAndroidChannel,
  ensurePermission,
  formatTime,
  getPermissionStatus,
  parseTime,
  scheduleDailyReminder,
} from "@/src/lib/reminders";
import { NotificationPrimerSheet } from "@/src/components/NotificationPrimerSheet";

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
  // Reminder — controls the native time picker sheet + a local pending flag
  // so we don't blast the OS with schedule calls on every state flicker.
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  // Pre-permission primer sheet — shown before the OS notification prompt
  // so the user opts INTO the OS dialog with intent (Build 16 polish).
  // See src/components/NotificationPrimerSheet.tsx for product rationale.
  const [primerOpen, setPrimerOpen] = useState(false);
  const auth = useAuthState();
  const isAuthed = !!auth.user;

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

  // -------------------------------------------------------------------------
  // Daily reminder wiring.
  //
  // Toggle-on flow:
  //   1. Ask for OS notification permission (only on the first flip — the OS
  //      short-circuits subsequent calls to whatever the user already chose).
  //   2. Schedule the repeating daily reminder at the currently-saved time.
  //   3. Persist notificationsEnabled=true.
  //   4. Show a "Daily reminders enabled." confirmation toast.
  //
  // If the OS denies permission, we roll back the toggle and point the user
  // at their system Settings instead of pretending it succeeded.
  //
  // Time-change flow:
  //   1. Persist the new HH:MM.
  //   2. Reschedule (cancels the previous, creates fresh with a new random
  //      message — see reminders.ts pickMessage()).
  //   3. Show "Reminder updated to 8:00 PM." confirmation.
  // -------------------------------------------------------------------------
  const handleReminderToggle = async (nextEnabled: boolean) => {
    if (reminderBusy) return;
    if (nextEnabled) {
      // Only show the primer sheet when we would actually invoke the OS
      // prompt — if the user has already granted permission (returning
      // user re-enabling), skip the sheet and go straight to scheduling
      // so the toggle feels responsive.
      const status = await getPermissionStatus();
      if (status.granted) {
        void completeEnableReminders();
      } else {
        setPrimerOpen(true);
      }
      return;
    }
    // Disable path: unchanged.
    setReminderBusy(true);
    try {
      await cancelAllDailyReminders();
      await onTogglePref("notificationsEnabled", false);
    } finally {
      setReminderBusy(false);
    }
  };

  // Actual permission-request + schedule flow, invoked after the user taps
  // "Continue" on the primer sheet OR when permission is already granted.
  const completeEnableReminders = async () => {
    setReminderBusy(true);
    try {
      const granted = await ensurePermission();
      if (!granted) {
        showToast({
          variant: "error",
          title: "Notifications are turned off.",
          message: "Enable them in Settings to receive reminders.",
          duration: 4500,
        });
        return;
      }
      await ensureAndroidChannel();
      const result = await scheduleDailyReminder(prefs.notificationsDailyTime);
      if (!result.ok) {
        // Two distinct paths: permission race (rare — user revoked
        // between our ensurePermission call and the schedule call) vs a
        // native scheduling error. Surface both clearly so we never fall
        // back on a generic 'try again' toast that hides the real bug.
        if (result.reason === "permission") {
          showToast({
            variant: "error",
            title: "Notifications are turned off.",
            message: "Enable them in Settings to receive reminders.",
            duration: 4500,
          });
        } else {
          console.error("[settings] schedule reminder error:", result.error);
          const detail =
            result.error instanceof Error
              ? result.error.message
              : String(result.error);
          showToast({
            variant: "error",
            title: "Couldn't set reminder",
            message: detail.slice(0, 140) || "Please try again.",
            duration: 5500,
          });
        }
        return;
      }
      await onTogglePref("notificationsEnabled", true);
      showToast({
        variant: "success",
        title: "Daily reminders enabled.",
        message: `You'll get a gentle nudge at ${formatTime(prefs.notificationsDailyTime)}.`,
        duration: 3000,
      });
    } finally {
      setReminderBusy(false);
    }
  };

  const handlePrimerContinue = () => {
    setPrimerOpen(false);
    // Give iOS a beat to finish the modal dismiss animation before
    // presenting the system permission dialog on top. Not required on
    // Android but harmless.
    setTimeout(() => {
      void completeEnableReminders();
    }, 200);
  };

  const handlePrimerCancel = () => {
    setPrimerOpen(false);
    // No OS prompt fired. The toggle stays OFF. User can re-enable any
    // time by tapping the toggle again — no trip to Settings.app needed.
  };

  const handleReminderRowPress = () => {
    if (!prefs.notificationsEnabled) return;
    setTimePickerOpen(true);
  };

  const handleTimePicked = async (event: DateTimePickerEvent, picked?: Date) => {
    // iOS "spinner" fires 'set' after user taps a bg element; Android fires
    // 'set' when the user confirms. On both platforms, 'dismissed' or
    // undefined picked means the user canceled — leave prefs alone.
    const dismissedOrCanceled =
      event.type === "dismissed" || !picked || Platform.OS !== "ios";
    // On Android the picker is a modal dialog that dismisses itself — we
    // always close our local state. On iOS the inline spinner needs an
    // explicit close.
    if (Platform.OS !== "ios") setTimePickerOpen(false);
    if (event.type === "dismissed" || !picked) return;

    const hh = String(picked.getHours()).padStart(2, "0");
    const mm = String(picked.getMinutes()).padStart(2, "0");
    const nextHhmm = `${hh}:${mm}`;
    if (nextHhmm === prefs.notificationsDailyTime) return;

    await onTogglePref("notificationsDailyTime", nextHhmm);
    if (prefs.notificationsEnabled) {
      const result = await scheduleDailyReminder(nextHhmm);
      if (!result.ok) {
        if (result.reason === "permission") {
          showToast({
            variant: "error",
            title: "Notifications are turned off.",
            message: "Enable them in Settings to receive reminders.",
            duration: 4500,
          });
        } else {
          console.error("[settings] reschedule reminder error:", result.error);
          const detail = result.error instanceof Error ? result.error.message : String(result.error);
          showToast({
            variant: "error",
            title: "Couldn't update reminder",
            message: detail.slice(0, 140) || "Please try again.",
            duration: 5500,
          });
        }
        return;
      }
    }
    showToast({
      variant: "success",
      title: `Reminder updated to ${formatTime(nextHhmm)}.`,
      message: prefs.notificationsEnabled
        ? "Your next reminder will arrive at the new time."
        : "Turn on Daily reminder to start receiving nudges.",
      duration: 3000,
    });
    // Suppress the unused parameter warning without changing behavior.
    void dismissedOrCanceled;
  };

  const closeTimePickerIOS = () => setTimePickerOpen(false);

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
          {isAuthed ? (
            <View style={styles.heroCard} testID="signed-in-card">
              <View style={styles.heroIconRing}>
                <Ionicons name="checkmark-circle-outline" size={22} color={colors.accent} />
              </View>
              <Text style={styles.heroTitle} testID="signed-in-email">
                {auth.user?.email || auth.user?.name || "Signed in"}
              </Text>
              <Text style={styles.heroSub}>
                {auth.provider === "google"
                  ? "Signed in with Google"
                  : auth.provider === "apple"
                  ? "Signed in with Apple"
                  : "Signed in with Email"}
              </Text>
              <View style={styles.benefitList}>
                <Benefit text="Your prayers, reflections, and streaks are safely backed up" />
                <Benefit text="Continue anywhere — switch devices anytime" />
              </View>
              <Pressable
                onPress={async () => {
                  await logout();
                  pop("Signed out. You're still here as a guest.");
                }}
                style={[styles.primaryBtn, styles.secondaryBtn]}
                testID="sign-out-button"
              >
                <Text style={styles.secondaryBtnText}>Sign out</Text>
              </Pressable>
              <Text style={styles.tinyNote}>
                Signing out preserves your local data on this device.
              </Text>
            </View>
          ) : (
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
                <Text style={styles.primaryBtnText}>Keep My Journey Safe</Text>
              </Pressable>
              <Text style={styles.tinyNote}>You can always continue as a guest.</Text>
            </View>
          )}
        </Section>

        {/* ---- NOTIFICATIONS ---- */}
        <Section label="Notifications">
          <Row
            title="Daily reminder"
            subtitle="A gentle nudge to pause and pray"
            testID="daily-reminder-row"
            right={
              reminderBusy ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Switch
                  value={prefs.notificationsEnabled}
                  onValueChange={handleReminderToggle}
                  trackColor={{ false: colors.surface2, true: colors.accent }}
                  thumbColor={colors.text}
                  ios_backgroundColor={colors.surface2}
                  testID="daily-reminder-switch"
                />
              )
            }
          />
          <Row
            title="Reminder time"
            subtitle={
              prefs.notificationsEnabled
                ? "Tap to change when your daily nudge arrives"
                : "Turn on Daily reminder to schedule"
            }
            disabled={!prefs.notificationsEnabled}
            right={
              <Text
                style={[
                  styles.chevronMeta,
                  !prefs.notificationsEnabled && styles.chevronMetaDisabled,
                ]}
              >
                {formatTime(prefs.notificationsDailyTime)}
              </Text>
            }
            onPress={handleReminderRowPress}
            testID="reminder-time-row"
          />
        </Section>

        {/* ---- DATA & SYNC ---- */}
        <Section label="Data & Sync">
          <Row
            title="My Journal"
            subtitle="Reflections and saved prayers"
            onPress={() => router.push("/reflections-history" as any)}
            right={<Chev />}
            testID="my-reflections-row"
          />
          <Row
            title="Export backup"
            subtitle="Save your spiritual journey as a JSON file"
            onPress={handleExport}
            right={exportBusy ? <ActivityIndicator color={colors.accent} /> : <Chev />}
            testID="export-backup-button"
          />
          <Row
            title="Cloud sync"
            testID="cloud-sync-row"
            subtitle="Available when you create an account"
            disabled
            right={<Text style={styles.locked}>Soon</Text>}
          />
        </Section>

        {/* ---- PRIVACY ---- */}
        <Section label="Privacy">
          <Row
            title="Improve Prayers Loft"
            testID="improve-prayers-loft-row"
            subtitle="Share anonymous usage signals"
            right={
              <Switch
                value={prefs.analyticsOptIn}
                onValueChange={(v) => onTogglePref("analyticsOptIn", v)}
                trackColor={{ true: colors.accent, false: "#33405A" }}
                thumbColor="#F8FAFC"
                accessibilityLabel="Improve Prayers Loft"
                accessibilityHint="Share anonymous usage signals"
              />
            }
          />
          <Row
            title="Erase local data"
            testID="erase-local-data-row"
            subtitle="Reset this device. Cannot be undone."
            onPress={handleWipe}
            danger
            right={<Chev tone="danger" />}
          />
          {isAuthed && (
            <Row
              title="Delete Account"
              subtitle="Permanently remove your cloud data and sign out."
              onPress={async () => {
                Alert.alert(
                  "Delete your account?",
                  "This permanently removes your saved prayers, reflections, and preferences from the cloud, revokes all sessions, and signs you out. Local data on this device is preserved. This cannot be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await deleteAccount();
                          pop("Your account has been removed.");
                        } catch (e: any) {
                          Alert.alert("Couldn't delete account", e?.message || "Please try again.");
                        }
                      },
                    },
                  ]
                );
              }}
              danger
              right={<Chev tone="danger" />}
              testID="delete-account-button"
            />
          )}
        </Section>

        {/* ---- ABOUT ---- */}
        <Section label="About">
          <Row title="Prayers Loft" subtitle={`${isAuthed ? "Signed in" : "Guest"} · ${Platform.OS}`} />
          <Row title="Made with care" subtitle="A quiet place to pray, reflect, and remember." />
          <Row title="About AI in Prayers Loft" subtitle="Prayers Loft uses AI to help you find words. You are always in control of what you pray and believe." />
          <Row
            title="Privacy Policy"
            subtitle="How we treat your prayers, reflections, and data."
            onPress={() => router.push("/privacy" as any)}
            right={<Chev />}
            testID="open-privacy"
          />
          <Row
            title="Terms of Service"
            subtitle="Your agreement with Prayers Loft."
            onPress={() => router.push("/terms" as any)}
            right={<Chev />}
            testID="open-terms"
          />
        </Section>

        {/* ---- DEVELOPER TOOLS ---- */}
        <Section label="Developer Tools">
          <Row
            title="Replay Onboarding"
            subtitle="Show the welcome carousel and AI disclosure again."
            onPress={async () => {
              await replayOnboarding();
              pop("Onboarding will replay now.");
            }}
            right={<Chev />}
            testID="replay-onboarding-button"
          />
        </Section>
      </ScrollView>

      {toast && (
        <View style={[styles.toast, { pointerEvents: "none" }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Native iOS time picker sheet.
          Rendered inline (Platform.OS === "ios") vs. as a modal dialog
          (Android). We anchor to the currently saved time and let iOS
          own the spinner UX; when the user taps "Done" the sheet closes
          via the wrapper Pressable's onPress. */}
      {timePickerOpen && Platform.OS === "ios" && (
        <Pressable style={styles.pickerBackdrop} onPress={closeTimePickerIOS} testID="time-picker-backdrop">
          <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.pickerHeader}>
              <Pressable onPress={closeTimePickerIOS} hitSlop={8} testID="time-picker-done">
                <Text style={styles.pickerDone}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={(() => {
                const { hour, minute } = parseTime(prefs.notificationsDailyTime);
                const d = new Date();
                d.setHours(hour, minute, 0, 0);
                return d;
              })()}
              mode="time"
              display="spinner"
              onChange={handleTimePicked}
              themeVariant="dark"
              textColor={colors.text}
              testID="time-picker"
            />
          </Pressable>
        </Pressable>
      )}
      {timePickerOpen && Platform.OS !== "ios" && (
        <DateTimePicker
          value={(() => {
            const { hour, minute } = parseTime(prefs.notificationsDailyTime);
            const d = new Date();
            d.setHours(hour, minute, 0, 0);
            return d;
          })()}
          mode="time"
          is24Hour={false}
          onChange={handleTimePicked}
          testID="time-picker"
        />
      )}

      {/* Pre-permission primer sheet (Build 16). Explains the benefit
          before the OS notification prompt appears, so users opt in with
          intent rather than reflexively dismissing. */}
      <NotificationPrimerSheet
        visible={primerOpen}
        onContinue={handlePrimerContinue}
        onCancel={handlePrimerCancel}
      />
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
    <View style={[styles.row, disabled && { opacity: 0.5 }]} testID={testID}>
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
  secondaryBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  secondaryBtnText: { fontFamily: fonts.sansSemibold, color: colors.text, fontSize: 14.5 },
  tinyNote: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 11.5, marginTop: 4 },

  locked: { fontFamily: fonts.sansMedium, color: colors.textTertiary, fontSize: 12 },
  // Right-side "8:00 PM" meta on the Reminder time row. Gold when the
  // toggle is on (feels tappable), muted when off (matches the row's
  // disabled state).
  chevronMeta: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.accent,
    letterSpacing: 0.2,
  },
  chevronMetaDisabled: {
    color: colors.textTertiary,
  },
  // Modal-ish iOS time picker sheet — dark backdrop + rounded bottom sheet
  // for the native spinner. Android uses the OS-provided dialog directly
  // so these styles are iOS-only.
  pickerBackdrop: {
    position: "absolute",
    top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    zIndex: 999,
  },
  pickerSheet: {
    backgroundColor: colors.bgDeep,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  pickerDone: {
    fontFamily: fonts.sansSemibold,
    color: colors.accent,
    fontSize: 15,
    letterSpacing: 0.2,
  },

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
