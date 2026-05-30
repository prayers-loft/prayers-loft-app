import { Stack } from "expo-router";
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
      SplashScreen.hideAsync();
      // Eagerly mint the stable anonymous guest_id on first launch.
      // Runs once per cold launch, fire-and-forget.
      getGuestIdentity().catch(() => {});
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: "#0a0e1a" }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0a0e1a" } }} />
          {!splashDone && <SplashOverlay onDone={() => setSplashDone(true)} />}
          <UpgradePromptHost />
        </View>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
