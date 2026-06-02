// Upgrade-prompt eligibility, throttling, and Phase-2 hand-off contract.
//
// Phase 1.5 ships polished UI + analytics with a placeholder CTA. When
// Phase 2 lands, the only change required is in `openAuthSheet` below —
// every trigger source, copy variant, and analytics event stays the same.
import { storage } from "@/src/utils/storage";
import { track } from "@/src/lib/analytics";

export type UpgradeTrigger =
  | "settings_backup_button"
  | "guest_soft_banner"
  | "seven_day_streak"
  | "five_prayers"
  | "five_reflections";

export type UpgradeVariant = {
  key: "backup" | "streak" | "entries";
  title: string;
  body: string;
  ctaLabel: string;
  dismissLabel: string;
};

export const VARIANTS: Record<UpgradeVariant["key"], UpgradeVariant> = {
  backup: {
    key: "backup",
    title: "Save your spiritual journey",
    body: "Create a free account soon to protect your prayers, reflections, and streaks across devices.",
    ctaLabel: "Keep My Journey Safe",
    dismissLabel: "Not Now",
  },
  streak: {
    key: "streak",
    title: "Protect your streak",
    body: "You've started building a meaningful rhythm. Soon, you'll be able to create a free account to keep your streak safe.",
    ctaLabel: "Keep My Journey Safe",
    dismissLabel: "Not Now",
  },
  entries: {
    key: "entries",
    title: "Keep your journey safe",
    body: "You've started building a meaningful spiritual journey. Soon, you'll be able to save it securely across devices.",
    ctaLabel: "Keep My Journey Safe",
    dismissLabel: "Not Now",
  },
};

export function variantForTrigger(t: UpgradeTrigger): UpgradeVariant {
  switch (t) {
    case "seven_day_streak":
      return VARIANTS.streak;
    case "five_prayers":
    case "five_reflections":
      return VARIANTS.entries;
    case "settings_backup_button":
    case "guest_soft_banner":
    default:
      return VARIANTS.backup;
  }
}

// --- Throttle state ---------------------------------------------------------
// We never spam the user. Each contextual trigger fires at most ONCE per
// device until the user manually re-engages from Settings. A short global
// cooldown also prevents two prompts in a row.

const KEY_STATE = "prayersloft_upgrade_state_v1";

type UpgradeState = {
  // Triggers that have already been shown (their `next-show` is gated).
  shown: Partial<Record<UpgradeTrigger, string>>; // value = ISO timestamp
  // Last time any prompt was shown.
  lastShownAt?: string;
  // Last time any prompt was dismissed.
  lastDismissedAt?: string;
};

async function readState(): Promise<UpgradeState> {
  const raw = await storage.getItem(KEY_STATE, "");
  if (!raw) return { shown: {} };
  try {
    return JSON.parse(String(raw)) as UpgradeState;
  } catch {
    return { shown: {} };
  }
}

async function writeState(s: UpgradeState): Promise<void> {
  await storage.setItem(KEY_STATE, JSON.stringify(s));
}

const MIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h between auto-fired prompts.

export async function shouldShowAutomatic(trigger: UpgradeTrigger): Promise<boolean> {
  // Manual triggers (user-tapped buttons) bypass throttle entirely.
  if (trigger === "settings_backup_button" || trigger === "guest_soft_banner") return true;

  const s = await readState();
  if (s.shown[trigger]) return false; // Each contextual trigger only once.
  if (s.lastShownAt) {
    const diff = Date.now() - new Date(s.lastShownAt).getTime();
    if (diff < MIN_COOLDOWN_MS) return false;
  }
  return true;
}

export async function recordShown(trigger: UpgradeTrigger): Promise<void> {
  const s = await readState();
  const now = new Date().toISOString();
  s.shown[trigger] = now;
  s.lastShownAt = now;
  await writeState(s);
  track("upgrade_prompt_viewed", { trigger_source: trigger });
}

export async function recordDismissed(trigger: UpgradeTrigger): Promise<void> {
  const s = await readState();
  s.lastDismissedAt = new Date().toISOString();
  await writeState(s);
  track("upgrade_prompt_dismissed", { trigger_source: trigger });
}

export async function recordCtaTapped(trigger: UpgradeTrigger): Promise<void> {
  track("upgrade_prompt_cta_tapped", { trigger_source: trigger });
}

// --- Phase-2 hand-off -------------------------------------------------------
// Phase 2 now ships a real bottom-sheet (Google / Email / Apple-flagged) via
// AuthHost. Every trigger source, copy variant, and analytics name above
// is unchanged from Phase 1.5.
import { requestAuthSheet } from "@/src/components/AuthHost";

export function openAuthSheet(trigger: UpgradeTrigger): void {
  requestAuthSheet(trigger);
}
