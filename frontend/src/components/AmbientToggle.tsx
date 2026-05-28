// Subtle ambient sound toggle. Lighter design.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAudioPlayer } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme/theme";
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
        player.volume = 0.3;
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // silent fallback
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
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
      hitSlop={12}
    >
      <View>
        <Ionicons
          name={enabled ? "volume-medium-outline" : "volume-mute-outline"}
          size={18}
          color={enabled ? colors.accent : colors.textTertiary}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface1,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});
