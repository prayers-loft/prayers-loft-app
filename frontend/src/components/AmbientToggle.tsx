// Ambient sound toggle (top-right). Persists state to local storage.
// Uses a soft royalty-free ambient loop; gracefully degrades if unreachable.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, Text } from "react-native";
import { useAudioPlayer } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";
import { getAmbientEnabled, setAmbientEnabled } from "@/src/lib/local-store";

const AMBIENT_URL = "https://cdn.pixabay.com/audio/2022/02/22/audio_d0c6ff1bdd.mp3";

export function AmbientToggle() {
  const [enabled, setEnabled] = useState(false);
  const player = useAudioPlayer({ uri: AMBIENT_URL });
  const initializedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const v = await getAmbientEnabled();
      setEnabled(v);
      initializedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!initializedRef.current) return;
    try {
      player.loop = true;
      if (enabled) {
        player.volume = 0.35;
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // Audio source not loaded — silent fallback
    }
  }, [enabled, player]);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await setAmbientEnabled(next);
  };

  return (
    <Pressable
      onPress={toggle}
      testID="ambient-toggle-button"
      accessibilityLabel={enabled ? "Mute ambient sound" : "Play ambient sound"}
      style={styles.btn}
      hitSlop={12}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name={enabled ? "notifications" : "notifications-off-outline"}
          size={18}
          color={enabled ? colors.gold : colors.textSecondary}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: { alignItems: "center", justifyContent: "center" },
});

// Brand mark used in headers
export function BrandMark() {
  return (
    <View style={brandStyles.row}>
      <Text style={brandStyles.dove}>🕊️</Text>
      <Text style={brandStyles.text}>Prayers Loft</Text>
    </View>
  );
}

const brandStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dove: { fontSize: 20 },
  text: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.ivory, letterSpacing: 0.3 },
});
