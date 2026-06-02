// Tiny helpers backing first-time UX gates:
//   - onboarding seen (once-only first-launch carousel)
//   - AI disclosure shown (once-only on first prayer)
import { storage } from "@/src/utils/storage";

const KEY_ONBOARDING = "prayersloft_onboarding_seen_v1";
const KEY_AI_DISCLOSURE = "prayersloft_ai_disclosure_seen_v1";

function _isUnderTest(): boolean {
  try {
    if (typeof navigator !== "undefined" && (navigator as any).webdriver === true) return true;
    if (typeof globalThis !== "undefined" && (globalThis as any).__PRAYERSLOFT_SKIP_ONBOARDING__) return true;
  } catch {}
  return false;
}

export async function hasSeenOnboarding(): Promise<boolean> {
  if (_isUnderTest()) return true;
  try {
    const v = await storage.getItem(KEY_ONBOARDING, "");
    return !!v;
  } catch {
    return false;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await storage.setItem(KEY_ONBOARDING, new Date().toISOString());
  } catch {}
}

export async function hasSeenAIDisclosure(): Promise<boolean> {
  if (_isUnderTest()) return true;
  try {
    const v = await storage.getItem(KEY_AI_DISCLOSURE, "");
    return !!v;
  } catch {
    return false;
  }
}

export async function markAIDisclosureSeen(): Promise<void> {
  try {
    await storage.setItem(KEY_AI_DISCLOSURE, new Date().toISOString());
  } catch {}
}

export async function resetFirstLaunchGates(): Promise<void> {
  await storage.setItem(KEY_ONBOARDING, "");
  await storage.setItem(KEY_AI_DISCLOSURE, "");
}
