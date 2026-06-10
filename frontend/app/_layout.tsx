import { Stack } from "expo-router";
import Head from "expo-router/head";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts as useCrimson, CrimsonText_400Regular, CrimsonText_400Regular_Italic, CrimsonText_700Bold } from "@expo-google-fonts/crimson-text";
import { useFonts as useInter, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { SplashOverlay } from "@/src/components/SplashOverlay";
import { getGuestIdentity } from "@/src/lib/guest-identity";
import { UpgradePromptHost } from "@/src/components/UpgradePromptHost";
import { AuthHost } from "@/src/components/AuthHost";
import { ToastHost } from "@/src/components/Toast";
import { OnboardingHost } from "@/src/components/OnboardingCarousel";
import { initAuth } from "@/src/lib/auth-store";
import { probeMe } from "@/src/lib/auth-api";
import { handleGoogleReturnFromUrl } from "@/src/lib/google-auth";
import { RootErrorBoundary } from "@/src/components/RootErrorBoundary";
import { getApiBase, getApiBaseSource } from "@/src/lib/api";
import { showToast } from "@/src/components/Toast";

// Keep the native splash visible from cold start until icon fonts register.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [crimsonLoaded] = useCrimson({
    CrimsonText_400Regular,
    CrimsonText_400Regular_Italic,
    CrimsonText_700Bold,
  });
  const [interLoaded] = useInter({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [splashDone, setSplashDone] = useState(false);

  const ready = (iconsLoaded || iconsError) && crimsonLoaded && interLoaded;

  useEffect(() => {
    if (ready) {
      // Startup config sanity check — loudly surface a misconfigured backend URL
      // so we never silently fail again (root cause of v1.0.0 build 5 outage).
      const apiBase = getApiBase();
      const apiBaseSource = getApiBaseSource();
      if (!apiBase) {
        showToast({
          variant: "error",
          title: "App configuration error",
          message: "Backend URL is not set. Please reinstall the latest build.",
          duration: 10000,
        });
        console.error("[RootLayout] EXPO_PUBLIC_BACKEND_URL is empty at runtime");
      } else {
        // BUILD_VERIFICATION_TEMP — Build 11 visibility toast.
        // Shows the resolved backend URL on cold start so QA/TestFlight
        // testers can visually confirm Build 11 is hitting the deployed host
        // (prayers-loft.emergent.host) and NOT the preview pod URL.
        // Remove after Build 11 verification (grep BUILD_VERIFICATION_TEMP).
        showToast({
          variant: "info",
          title: `Build verification`,
          message: `API: ${apiBase}\nfrom: ${apiBaseSource}`,
          duration: 6000,
        });
        // eslint-disable-next-line no-console
        console.log(`[RootLayout] BUILD_VERIFICATION_TEMP — apiBase="${apiBase}" source=${apiBaseSource}`);
      }
      // Hide native splash. Defensive try/catch — if Expo's splash module fails,
      // do NOT let the error abort the process (root cause of v1.0.0 (2) crash).
      try {
        SplashScreen.hideAsync();
      } catch (e) {
        console.warn("[RootLayout] SplashScreen.hideAsync failed", e);
      }
      // Eagerly mint the stable anonymous guest_id on first launch.
      // Runs once per cold launch, fire-and-forget.
      try {
        getGuestIdentity().catch((e) => console.warn("[RootLayout] guest_id init failed", e));
      } catch (e) {
        console.warn("[RootLayout] guest_id sync failed", e);
      }
      // Restore persisted auth state (no-op if signed-out), then opportunistically
      // process a Google OAuth return URL (web only), then validate token via /me.
      // Each step is independently guarded so a single failure can't crash startup.
      (async () => {
        try { await initAuth(); } catch (e) { console.warn("[RootLayout] initAuth failed", e); }
        try { await handleGoogleReturnFromUrl(); } catch (e) { console.warn("[RootLayout] google return failed", e); }
        try { await probeMe(); } catch (e) { console.warn("[RootLayout] probeMe failed", e); }
      })();
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <KeyboardProvider>
          <Head>
            <title>Prayers Loft</title>
            <meta
              name="description"
              content="A quiet place to pray, reflect, and remember. Prayer assistant, daily scripture, and reflections — by Prayers Loft."
            />
          </Head>
          <StatusBar style="light" />
          <View style={{ flex: 1, backgroundColor: "#0a0e1a" }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0a0e1a" } }} />
            {!splashDone && <SplashOverlay onDone={() => setSplashDone(true)} />}
            <UpgradePromptHost />
            <AuthHost />
            <ToastHost />
            <OnboardingHost />
          </View>
        </KeyboardProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
