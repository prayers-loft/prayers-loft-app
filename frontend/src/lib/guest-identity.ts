// Stable anonymous guest identity for Prayers Loft.
//
// A `guest_id` is generated on first launch and persisted locally. It is the
// key under which all of this user's data is tracked while they remain in
// Guest Mode. When a user later upgrades to an account (Phase 2), the server
// will rekey all records from this guest_id to the new authenticated user_id
// — zero data loss, no streak reset.
//
// This module is intentionally tiny and side-effect free so it can be loaded
// from the splash path without slowing cold launch.
import * as Crypto from "expo-crypto";
import { storage } from "@/src/utils/storage";

const KEY = "prayersloft_guest_id";
const CREATED_AT_KEY = "prayersloft_guest_created_at";

let inMemory: { id: string; createdAt: string } | null = null;

function newId(): string {
  // Crypto.randomUUID exists in expo-crypto >= 13.x.
  try {
    // @ts-expect-error — method exists at runtime even when TS lib types lag.
    if (typeof Crypto.randomUUID === "function") return Crypto.randomUUID();
  } catch {}
  // Fallback: random hex.
  return (
    Date.now().toString(36) +
    "-" +
    Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join("")
  );
}

export async function getGuestIdentity(): Promise<{ id: string; createdAt: string }> {
  if (inMemory) return inMemory;
  const existingId = await storage.getItem(KEY, "");
  const existingCreated = await storage.getItem(CREATED_AT_KEY, "");
  if (existingId) {
    inMemory = {
      id: String(existingId),
      createdAt: String(existingCreated) || new Date().toISOString(),
    };
    return inMemory;
  }
  const fresh = { id: newId(), createdAt: new Date().toISOString() };
  await storage.setItem(KEY, fresh.id);
  await storage.setItem(CREATED_AT_KEY, fresh.createdAt);
  inMemory = fresh;
  return fresh;
}

export async function getGuestId(): Promise<string> {
  return (await getGuestIdentity()).id;
}

/** For Phase 2: clear the local guest identity after a successful migration. */
export async function clearGuestIdentity(): Promise<void> {
  inMemory = null;
  await storage.setItem(KEY, "");
  await storage.setItem(CREATED_AT_KEY, "");
}
