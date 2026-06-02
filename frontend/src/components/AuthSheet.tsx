// Phase-2 bottom-sheet that presents Google, (Apple — feature-flagged), and
// Email/password options. Replaces the placeholder Alert in upgrade-prompts.
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";
import { UpgradeTrigger } from "@/src/lib/upgrade-prompts";
import { registerEmail, loginEmail, requestPasswordReset } from "@/src/lib/auth-api";
import { startGoogleSignIn } from "@/src/lib/google-auth";
import { showToast } from "@/src/components/Toast";

const APPLE_ENABLED = false; // Apple Sign-In feature flag (see backend APPLE_SIGN_IN_ENABLED).

type Mode = "choose" | "email-login" | "email-register" | "email-forgot";

export function AuthSheet({
  visible,
  trigger,
  onClose,
}: {
  visible: boolean;
  trigger: UpgradeTrigger | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("choose");
    setEmail("");
    setPassword("");
    setName("");
    setBusy(false);
    setError(null);
  }

  function handleClose() {
    reset();
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
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={handleClose}
        testID="auth-sheet-backdrop"
      />
      <View style={styles.sheet} testID="auth-sheet" pointerEvents="box-none">
        <View style={styles.sheetInner}>
          <View style={styles.grabber} />
          <Text style={styles.title} testID="auth-sheet-title">
            {mode === "choose"
              ? "Save your spiritual journey"
              : mode === "email-register"
              ? "Create your account"
              : mode === "email-forgot"
              ? "Reset your password"
              : "Welcome back"}
          </Text>
          <Text style={styles.subtitle}>
            {mode === "choose"
              ? "Sign in to back up your prayers, reflections, and streaks."
              : mode === "email-register"
              ? "We'll keep your journey safe across devices."
              : mode === "email-forgot"
              ? "Enter your email and we'll send a reset link."
              : "Sign in to restore your saved journey."}
          </Text>

          {mode === "choose" && (
            <View style={styles.list}>
              <Pressable
                style={[styles.providerBtn, styles.googleBtn]}
                onPress={onGoogle}
                disabled={busy}
                testID="auth-google-btn"
              >
                <Ionicons name="logo-google" size={18} color="#1a1a1a" />
                <Text style={styles.googleText}>Continue with Google</Text>
              </Pressable>

              {APPLE_ENABLED && Platform.OS === "ios" && (
                <Pressable
                  style={[styles.providerBtn, styles.appleBtn]}
                  onPress={() => Alert.alert("Apple Sign-In", "Coming soon on iOS builds.")}
                  disabled={busy}
                  testID="auth-apple-btn"
                >
                  <Ionicons name="logo-apple" size={18} color="#fff" />
                  <Text style={styles.appleText}>Continue with Apple</Text>
                </Pressable>
              )}

              <Pressable
                style={[styles.providerBtn, styles.emailBtn]}
                onPress={() => setMode("email-login")}
                disabled={busy}
                testID="auth-email-btn"
              >
                <Ionicons name="mail-outline" size={18} color={colors.text} />
                <Text style={styles.emailText}>Continue with Email</Text>
              </Pressable>

              <Text style={styles.fineprint}>
                You can keep using Prayers Loft as a Guest anytime.
              </Text>
            </View>
          )}

          {mode !== "choose" && (
            <View style={styles.form}>
              {mode === "email-register" && (
                <TextInput
                  style={styles.input}
                  placeholder="Your name (optional)"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="words"
                  value={name}
                  onChangeText={setName}
                  testID="auth-input-name"
                />
              )}
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                testID="auth-input-email"
              />
              {mode !== "email-forgot" && (
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  testID="auth-input-password"
                />
              )}
              {error ? (
                <Text style={styles.errorText} testID="auth-error">
                  {error}
                </Text>
              ) : null}
              <Pressable
                style={[styles.providerBtn, styles.primaryBtn]}
                onPress={onEmailSubmit}
                disabled={busy}
                testID="auth-submit"
              >
                {busy ? (
                  <ActivityIndicator color="#0c1024" />
                ) : (
                  <Text style={styles.primaryText}>
                    {mode === "email-register"
                      ? "Create account"
                      : mode === "email-forgot"
                      ? "Send reset link"
                      : "Sign in"}
                  </Text>
                )}
              </Pressable>
              {mode === "email-login" && (
                <Pressable
                  onPress={() => setMode("email-forgot")}
                  style={styles.switchBtn}
                  testID="auth-forgot-link"
                >
                  <Text style={styles.switchText}>Forgot password?</Text>
                </Pressable>
              )}
              {mode !== "email-forgot" && (
                <Pressable
                  onPress={() =>
                    setMode(mode === "email-register" ? "email-login" : "email-register")
                  }
                  style={styles.switchBtn}
                  testID="auth-switch-mode"
                >
                  <Text style={styles.switchText}>
                    {mode === "email-register"
                      ? "Already have an account? Sign in"
                      : "New here? Create an account"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setMode(mode === "email-forgot" ? "email-login" : "choose")}
                style={styles.backBtn}
              >
                <Text style={styles.backText}>← Back</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            onPress={handleClose}
            style={styles.dismissBtn}
            testID="auth-sheet-dismiss"
          >
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </View>
      </View>
      {/* trigger is currently used only for analytics gating upstream */}
      {void trigger}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,10,22,0.72)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetInner: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: "rgba(200,169,107,0.18)",
  },
  grabber: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 14,
  },
  title: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  list: { gap: 10 },
  form: { gap: 10 },
  providerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  googleBtn: { backgroundColor: "#FFFFFF" },
  googleText: { color: "#1a1a1a", fontFamily: fonts.sansSemibold, fontSize: 15 },
  appleBtn: { backgroundColor: "#000" },
  appleText: { color: "#fff", fontFamily: fonts.sansSemibold, fontSize: 15 },
  emailBtn: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  emailText: { color: colors.text, fontFamily: fonts.sansSemibold, fontSize: 15 },
  primaryBtn: { backgroundColor: colors.accent },
  primaryText: { color: "#0c1024", fontFamily: fonts.sansSemibold, fontSize: 15 },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  errorText: {
    color: "#FCA5A5",
    fontFamily: fonts.sans,
    fontSize: 13,
    paddingHorizontal: 4,
  },
  switchBtn: { alignItems: "center", paddingVertical: 8 },
  switchText: { color: colors.accent, fontFamily: fonts.sansMedium, fontSize: 13 },
  backBtn: { alignItems: "center" },
  backText: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 13 },
  fineprint: {
    color: colors.textTertiary,
    fontFamily: fonts.sans,
    fontSize: 12,
    textAlign: "center",
    marginTop: 6,
  },
  dismissBtn: { alignItems: "center", paddingVertical: 10, marginTop: 4 },
  dismissText: { color: colors.textSecondary, fontFamily: fonts.sansMedium, fontSize: 13 },
});
