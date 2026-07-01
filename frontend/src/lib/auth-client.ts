// Authenticated fetch wrapper with auto-refresh on 401 (single-flight).
// All API calls in the app should funnel through `authFetch` once auth ships,
// but legacy unauthenticated calls (daily verse, prayer-request, etc.) continue
// to work via raw fetch — auth is additive, not gating.
import Constants from "expo-constants";
import { getAuthState, patchTokens, clearAuth, AuthTokens } from "@/src/lib/auth-store";
import { markSessionExpired } from "@/src/lib/api";

function backendBase(): string {
  // Resolve the same EXPO_PUBLIC_BACKEND_URL the rest of the app uses.
  // Tries (in order): process.env (works on web), Expo Constants.
  // Falls back to relative "" so the ingress at "/api/*" handles it.
  const fromProcess = typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_BACKEND_URL : undefined;
  const fromExpo =
    (Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL ||
    (Constants?.manifest as any)?.extra?.EXPO_PUBLIC_BACKEND_URL;
  return (fromProcess || fromExpo || "").replace(/\/$/, "");
}

export function apiUrl(path: string): string {
  const base = backendBase();
  if (!path.startsWith("/")) path = "/" + path;
  return base ? `${base}${path}` : path;
}

let refreshInFlight: Promise<AuthTokens | null> | null = null;

async function doRefresh(): Promise<AuthTokens | null> {
  const { tokens } = getAuthState();
  if (!tokens?.refresh_token) return null;
  try {
    const resp = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    if (!resp.ok) {
      // Refresh rejected. Clear the session AND signal the api.ts
      // interceptor so subsequent owner-scoped calls short-circuit with
      // AuthExpiredError instead of silently becoming guest writes.
      await clearAuth();
      markSessionExpired();
      return null;
    }
    const data = (await resp.json()) as AuthTokens;
    if (!data?.access_token || !data?.refresh_token) {
      await clearAuth();
      markSessionExpired();
      return null;
    }
    await patchTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    return data;
  } catch {
    // Network error mid-refresh. Same treatment: kill auth, arm the guard.
    await clearAuth();
    markSessionExpired();
    return null;
  }
}

async function ensureRefresh(): Promise<AuthTokens | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function authFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith("http") ? path : apiUrl(path);
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const { tokens } = getAuthState();
  if (tokens?.access_token) headers.set("Authorization", `Bearer ${tokens.access_token}`);

  let resp = await fetch(url, { ...init, headers });
  if (resp.status !== 401 || !tokens?.refresh_token) return resp;

  // Try a single-flight refresh, then retry once.
  const next = await ensureRefresh();
  if (!next) {
    // ensureRefresh() -> doRefresh() has already run clearAuth() +
    // markSessionExpired() on the failure path.
    return resp;
  }
  const retryHeaders = new Headers(init.headers || {});
  if (!retryHeaders.has("Content-Type") && init.body) {
    retryHeaders.set("Content-Type", "application/json");
  }
  retryHeaders.set("Authorization", `Bearer ${next.access_token}`);
  resp = await fetch(url, { ...init, headers: retryHeaders });
  return resp;
}

export async function postJson<T = any>(path: string, body: any): Promise<T> {
  const resp = await authFetch(path, { method: "POST", body: JSON.stringify(body) });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data && (data.detail || data.message)) || `Request failed (${resp.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export async function getJson<T = any>(path: string): Promise<T> {
  const resp = await authFetch(path, { method: "GET" });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data && (data.detail || data.message)) || `Request failed (${resp.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}
