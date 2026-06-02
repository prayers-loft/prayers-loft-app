// Phase-2 full-screen authentication sheet.
// Designed to feel like Calm / Headspace / Notion / Apple Health — a focused
// experience, not a popup. True full-screen modal with a nearly-opaque scrim
// so the underlying app surface never visually competes.
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "@/src/theme/theme";
import { UpgradeTrigger } from "@/src/lib/upgrade-prompts";
import {
  registerEmail,
  loginEmail,
  requestPasswordReset,
} from "@/src/lib/auth-api";
import { startGoogleSignIn } from "@/src/lib/google-auth";
import { showToast } from "@/src/components/Toast";

const APPLE_ENABLED = false; // Apple Sign-In feature flag (see backend APPLE_SIGN_IN_ENABLED).

type Mode = "choose" | "email-login" | "email-register" | "email-forgot";

const BENEFITS = [
  "Sync across devices",
  "Protect your reflections",
  "Preserve your streaks",
  "Never lose your spiritual journey",
];

export function AuthSheet({
  visible,
  trigger,
  onClose,
}: {
  visible: boolean;
  trigger: UpgradeTrigger | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal state every time the sheet is freshly opened.
  useEffect(() => {
    if (visible) {
      setMode("choose");
      setEmail("");
      setPassword("");
      setName("");
      setBusy(false);
      setError(null);
    }
  }, [visible]);

  function handleClose() {
    onClose();
  }

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      const user = await startGoogleSignIn();
      if (user) {
        showToast({
          variant: "success",
          title: "Welcome",
          message: `Signed in as ${user.email || user.name || "your account"}.`,
        });
        handleClose();
      } else {
        setError("Google sign-in was cancelled.");
      }
    } catch (e: any) {
      setError(e?.message || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onForgotSubmit() {
    setError(null);
    if (!email) {
      setError("Please enter your email.");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email);
      showToast({
        variant: "info",
        title: "Check your email",
        message: "If that address is registered, a reset link is on its way.",
        duration: 4500,
      });
      handleClose();
    } catch (e: any) {
      setError(e?.message || "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSubmit() {
    setError(null);
    if (mode === "email-forgot") return onForgotSubmit();
    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }
    if (password.length < 8 && mode === "email-register") {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const user =
        mode === "email-register"
          ? await registerEmail(email, password, name || undefined)
          : await loginEmail(email, password);
      showToast({
        variant: "success",
        title: mode === "email-register" ? "Welcome to Prayers Loft" : "Welcome back",
        message: user.email ? `Signed in as ${user.email}.` : "You're signed in.",
      });
      handleClose();
    } catch (e: any) {
      setError(e?.message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      <View style={styles.root} testID="auth-sheet">
        {/* Top safe area + close affordance */}
        <View
          style={[
            styles.topBar,
            { paddingTop: (insets.top || 12) + 8 },
          ]}
        >
          <Pressable
            onPress={handleClose}
            style={styles.closeBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="auth-sheet-close"
          >
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: (insets.bottom || 24) + 32 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heroBlock}>
              <View style={styles.brandRing}>
                <Ionicons name="leaf-outline" size={22} color={colors.accent} />
              </View>
              <Text style={styles.title} testID="auth-sheet-title">
                {mode === "choose"
                  ? "Keep your journey safe"
                  : mode === "email-register"
                  ? "Create your account"
                  : mode === "email-forgot"
                  ? "Reset your password"
                  : "Welcome back"}
              </Text>
              <Text style={styles.subtitle}>
                {mode === "choose"
                  ? "Save your prayers, reflections, and streaks across devices."
                  : mode === "email-register"
                  ? "We'll keep your journey safe across devices."
                  : mode === "email-forgot"
                  ? "Enter your email and we'll send a reset link."
                  : "Sign in to restore your journey."}
              </Text>
            </View>

            {mode === "choose" && (
              <View style={styles.chooseBlock}>
                <View style={styles.benefitList}>
                  {BENEFITS.map((b) => (
                    <View key={b} style={styles.benefitRow}>
                      <View style={styles.benefitDot}>
                        <Ionicons name="checkmark" size={13} color={colors.accent} />
                      </View>
                      <Text style={styles.benefitText}>{b}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.actions}>
                  <Pressable
                    onPress={onGoogle}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.btn,
                      styles.googleBtn,
                      pressed && styles.btnPressed,
                    ]}
                    testID="auth-google-btn"
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Google"
                  >
                    {busy ? (
                      <ActivityIndicator color="#1a1a1a" />
                    ) : (
                      <>
                        <Ionicons name="logo-google" size={18} color="#1a1a1a" />
                        <Text style={styles.googleText}>Continue with Google</Text>
                      </>
                    )}
                  </Pressable>

                  {APPLE_ENABLED && Platform.OS === "ios" && (
                    <Pressable
                      onPress={() =>
                        showToast({ variant: "info", title: "Apple Sign-In", message: "Coming soon." })
                      }
                      disabled={busy}
                      style={({ pressed }) => [styles.btn, styles.appleBtn, pressed && styles.btnPressed]}
                      testID="auth-apple-btn"
                    >
                      <Ionicons name="logo-apple" size={18} color="#fff" />
                      <Text style={styles.appleText}>Continue with Apple</Text>
                    </Pressable>
                  )}

                  <Pressable
                    onPress={() => setMode("email-login")}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.btn,
                      styles.emailBtn,
                      pressed && styles.btnPressed,
                    ]}
                    testID="auth-email-btn"
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Email"
                  >
                    <Ionicons name="mail-outline" size={18} color={colors.text} />
                    <Text style={styles.emailText}>Continue with Email</Text>
                  </Pressable>
                </View>

                <Pressable
                  onPress={handleClose}
                  style={styles.notNowBtn}
                  testID="auth-sheet-dismiss"
                >
                  <Text style={styles.notNowText}>Not now</Text>
                </Pressable>

                <Text style={styles.legalLine}>
                  By continuing you agree to our{" "}
                  <Text
                    style={styles.legalLink}
                    onPress={() => {
                      handleClose();
                      setTimeout(() => router.push("/terms" as any), 120);
                    }}
                    testID="auth-terms-link"
                  >
                    Terms
                  </Text>
                  {" and "}
                  <Text
                    style={styles.legalLink}
                    onPress={() => {
                      handleClose();
                      setTimeout(() => router.push("/privacy" as any), 120);
                    }}
                    testID="auth-privacy-link"
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </View>
            )}

            {mode !== "choose" && (
              <View style={styles.formBlock}>
                {mode === "email-register" && (
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Name (optional)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Your name"
                      placeholderTextColor={colors.textTertiary}
                      autoCapitalize="words"
                      value={name}
                      onChangeText={setName}
                      testID="auth-input-name"
                    />
                  </View>
                )}
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    testID="auth-input-email"
                  />
                </View>

                {mode !== "email-forgot" && (
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Password</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={mode === "email-register" ? "At least 8 characters" : "Password"}
                      placeholderTextColor={colors.textTertiary}
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                      testID="auth-input-password"
                    />
                  </View>
                )}

                {mode === "email-login" && (
                  <Pressable
                    onPress={() => {
                      setError(null);
                      setMode("email-forgot");
                    }}
                    style={styles.forgotBtn}
                    testID="auth-forgot-link"
                  >
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </Pressable>
                )}

                {error ? (
                  <Text style={styles.errorText} testID="auth-error">
                    {error}
                  </Text>
                ) : null}

                <Pressable
                  onPress={onEmailSubmit}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.primaryBtn,
                    pressed && styles.btnPressed,
                    busy && styles.btnDisabled,
                  ]}
                  testID="auth-submit"
                  accessibilityRole="button"
                >
                  {busy ? (
                    <ActivityIndicator color="#0c1024" />
                  ) : (
                    <Text style={styles.primaryText}>
                      {mode === "email-register"
                        ? "Create Account"
                        : mode === "email-forgot"
                        ? "Send reset link"
                        : "Sign In"}
                    </Text>
                  )}
                </Pressable>

                {mode !== "email-forgot" && (
                  <View style={styles.switchRow}>
                    <Text style={styles.switchPrompt}>
                      {mode === "email-register"
                        ? "Already have an account?"
                        : "Don't have an account?"}
                    </Text>
                    <Pressable
                      onPress={() =>
                        setMode(mode === "email-register" ? "email-login" : "email-register")
                      }
                      hitSlop={8}
                      testID="auth-switch-mode"
                    >
                      <Text style={styles.switchAction}>
                        {mode === "email-register" ? "Sign in" : "Create one"}
                      </Text>
                    </Pressable>
                  </View>
                )}

                <Pressable
                  onPress={() => setMode(mode === "email-forgot" ? "email-login" : "choose")}
                  style={styles.backBtn}
                  hitSlop={8}
                  testID="auth-back"
                >
                  <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
                  <Text style={styles.backText}>Back</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
      {/* trigger is currently used only for analytics gating upstream */}
      {void trigger}
    </Modal>
  );
}

// Spacing tokens (8pt grid)
const S = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 };

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0a0e1a", // Solid Midnight Indigo — fully covers underlying app.
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: S.md,
    paddingBottom: S.sm,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  scroll: {
    paddingHorizontal: S.lg + 4,
    paddingTop: S.md,
  },

  // ---- HERO ----
  heroBlock: {
    alignItems: "center",
    marginTop: S.sm,
    marginBottom: S.xl,
  },
  brandRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.34)",
    backgroundColor: "rgba(200,169,107,0.08)",
    marginBottom: S.md,
  },
  title: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: -0.2,
    marginBottom: S.sm + 2,
    paddingHorizontal: 8,
  },
  subtitle: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 17,
    lineHeight: 25,
    textAlign: "center",
    maxWidth: 340,
  },

  // ---- CHOOSE ----
  chooseBlock: { gap: S.lg },
  benefitList: { gap: 12, marginBottom: S.sm },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
  },
  benefitDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(200,169,107,0.14)",
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.28)",
  },
  benefitText: {
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: { gap: 12 },

  // ---- BUTTONS ----
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  btnPressed: { opacity: 0.88 },
  btnDisabled: { opacity: 0.55 },
  googleBtn: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
  googleText: { color: "#1a1a1a", fontFamily: fonts.sansSemibold, fontSize: 16 },
  appleBtn: { backgroundColor: "#000" },
  appleText: { color: "#fff", fontFamily: fonts.sansSemibold, fontSize: 16 },
  emailBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  emailText: { color: colors.text, fontFamily: fonts.sansSemibold, fontSize: 16 },
  primaryBtn: {
    backgroundColor: colors.accent,
    marginTop: S.sm,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
  primaryText: { color: "#0c1024", fontFamily: fonts.sansSemibold, fontSize: 16, letterSpacing: 0.2 },

  notNowBtn: { alignItems: "center", paddingVertical: S.sm + 2, marginTop: S.xs },
  notNowText: {
    color: colors.textSecondary,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
  },

  legalLine: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textTertiary,
    textAlign: "center",
    paddingHorizontal: 16,
    marginTop: S.xs,
  },
  legalLink: { color: colors.accent },

  // ---- FORM ----
  formBlock: { gap: S.md + 4 },
  field: { gap: 8 },
  fieldLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.textTertiary,
    paddingHorizontal: 2,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
    minHeight: 52,
  },

  forgotBtn: { alignSelf: "flex-end", paddingVertical: 4, paddingHorizontal: 4 },
  forgotText: {
    color: colors.accent,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
  },

  errorText: {
    color: "#FCA5A5",
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 4,
    marginTop: -4,
  },

  switchRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: S.xs,
  },
  switchPrompt: {
    color: colors.textSecondary,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  switchAction: {
    color: colors.accent,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
  },

  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 2,
    paddingVertical: S.sm,
    marginTop: S.xs,
  },
  backText: {
    color: colors.textSecondary,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
  },
});
