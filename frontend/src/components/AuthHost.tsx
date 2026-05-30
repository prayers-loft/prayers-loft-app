// Global listener that mounts the AuthSheet when any caller invokes
// `openAuthSheet(trigger)` from upgrade-prompts.ts. This is the Phase-2
// realization of the placeholder Alert.
import React, { useEffect, useState } from "react";
import { DeviceEventEmitter } from "react-native";
import { AuthSheet } from "@/src/components/AuthSheet";
import { UpgradeTrigger } from "@/src/lib/upgrade-prompts";

const EVT = "prayersloft:open-auth-sheet";

export function requestAuthSheet(trigger: UpgradeTrigger): void {
  DeviceEventEmitter.emit(EVT, trigger);
}

export function AuthHost() {
  const [trigger, setTrigger] = useState<UpgradeTrigger | null>(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT, (t: UpgradeTrigger) => setTrigger(t));
    return () => sub.remove();
  }, []);

  if (!trigger) return null;
  return (
    <AuthSheet
      visible={true}
      trigger={trigger}
      onClose={() => setTrigger(null)}
    />
  );
}
