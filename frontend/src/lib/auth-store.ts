// In-memory + persistent auth state with a tiny event-emitter for React subscribers.
// Tokens live in expo-secure-store on native (encrypted Keychain / Keystore) and in
// localStorage on web (per the Emergent Auth playbook's web fallback).
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export type AuthProvider = "email" | "google" | "apple";

export type AuthUser = {
  id: string;
  email: string | null;
  name?: string | null;
  picture?: string | null;
  providers: AuthProvider[];
  createdAt?: string | null;
};

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
};

export type AuthState = {
  user: AuthUser | null;
  tokens: AuthTokens | null;
  provider: AuthProvider | null;
  ready: boolean; // initial restore complete
};

const STORAGE_KEY = "prayersloft_auth_v1";

let state: AuthState = { user: null, tokens: null, provider: null, ready: false };
const listeners = new Set<(s: AuthState) => void>();

async function readPersisted(): Promise<Pick<AuthState, "user" | "tokens" | "provider"> | null> {
  try {
    let raw: string | null = null;
    if (Platform.OS === "web") {
      raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    } else {
      raw = await SecureStore.getItemAsync(STORAGE_KEY);
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.tokens || !parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writePersisted(
  payload: Pick<AuthState, "user" | "tokens" | "provider"> | null
): Promise<void> {
  try {
    if (payload == null) {
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
      } else {
        await SecureStore.deleteItemAsync(STORAGE_KEY);
      }
      return;
    }
    const serialized = JSON.stringify(payload);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, serialized);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, serialized);
    }
  } catch {
    // ignore — auth state is best-effort
  }
}

function emit() {
  for (const l of Array.from(listeners)) {
    try {
      l(state);
    } catch {}
  }
}

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuth(l: (s: AuthState) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function initAuth(): Promise<void> {
  const persisted = await readPersisted();
  if (persisted) {
    state = { ...state, ...persisted, ready: true };
  } else {
    state = { ...state, ready: true };
  }
  emit();
}

export async function setAuth(
  next: Pick<AuthState, "user" | "tokens" | "provider">
): Promise<void> {
  state = { ...state, ...next, ready: true };
  await writePersisted(next);
  emit();
}

export async function patchTokens(tokens: AuthTokens): Promise<void> {
  if (!state.user) return;
  state = { ...state, tokens };
  await writePersisted({ user: state.user, tokens, provider: state.provider });
  emit();
}

export async function clearAuth(): Promise<void> {
  state = { user: null, tokens: null, provider: null, ready: true };
  await writePersisted(null);
  emit();
}
