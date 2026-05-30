// Lightweight global controller for the upgrade prompt.
// Other modules call `requestUpgradePrompt(trigger)` and the global host
// (mounted once in _layout) takes care of showing the sheet with throttling.
import { useEffect, useState } from "react";
import { shouldShowAutomatic, UpgradeTrigger } from "@/src/lib/upgrade-prompts";
import { UpgradePromptSheet } from "@/src/components/UpgradePromptSheet";

type Listener = (t: UpgradeTrigger) => void;
let activeListener: Listener | null = null;
let queued: UpgradeTrigger | null = null;

export function requestUpgradePrompt(trigger: UpgradeTrigger): void {
  (async () => {
    const ok = await shouldShowAutomatic(trigger);
    if (!ok) return;
    if (activeListener) activeListener(trigger);
    else queued = trigger;
  })();
}

/** Force-open a prompt regardless of throttling (used for manual taps). */
export function forceUpgradePrompt(trigger: UpgradeTrigger): void {
  if (activeListener) activeListener(trigger);
  else queued = trigger;
}

export function UpgradePromptHost() {
  const [visible, setVisible] = useState(false);
  const [trigger, setTrigger] = useState<UpgradeTrigger | null>(null);

  useEffect(() => {
    activeListener = (t) => {
      setTrigger(t);
      setVisible(true);
    };
    if (queued) {
      const t = queued;
      queued = null;
      activeListener(t);
    }
    return () => {
      activeListener = null;
    };
  }, []);

  return (
    <UpgradePromptSheet
      visible={visible}
      trigger={trigger}
      onClose={() => setVisible(false)}
    />
  );
}
