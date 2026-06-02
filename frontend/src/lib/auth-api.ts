// High-level auth API: register / login / logout / google session-exchange /
// /me probe. These are the only call sites the UI should invoke.
import { postJson, authFetch } from "@/src/lib/auth-client";
import { AuthTokens, AuthUser, setAuth, clearAuth, getAuthState } from "@/src/lib/auth-store";
import { runGuestMigration } from "@/src/lib/account-migration";
import { showToast } from "@/src/components/Toast";

type AuthResponse = { user: AuthUser; tokens: AuthTokens };

/**
 * Fire-and-forget guest migration after first sign-in. On a successful
 * non-replay migration, surface the in-app toast with the backend-provided
 * copy: "Your spiritual journey has been safely saved."
 */
async function postSigninMigrate(): Promise<void> {
  try {
    const result = await runGuestMigration();
    if (!result) return; // either already migrated on this device, or a 409 cross-user collision
    if (!result.already_migrated) {
      showToast({
        variant: "success",
        title: "Journey Saved",
        message: result.message || "Your spiritual journey has been safely saved.",
        duration: 4200,
      });
    }
  } catch {
    // ignore — migration is best-effort
  }
}

export async function registerEmail(email: string, password: string, name?: string): Promise<AuthUser> {
  const data = await postJson<AuthResponse>("/api/auth/register", {
    email: email.trim().toLowerCase(),
    password,
    ...(name ? { name } : {}),
  });
  await setAuth({ user: data.user, tokens: data.tokens, provider: "email" });
  void postSigninMigrate();
  return data.user;
}

export async function loginEmail(email: string, password: string): Promise<AuthUser> {
  const data = await postJson<AuthResponse>("/api/auth/login", {
    email: email.trim().toLowerCase(),
    password,
  });
  await setAuth({ user: data.user, tokens: data.tokens, provider: "email" });
  void postSigninMigrate();
  return data.user;
}

export async function exchangeGoogleSession(session_id: string): Promise<AuthUser> {
  const data = await postJson<AuthResponse>("/api/auth/google", { session_id });
  await setAuth({ user: data.user, tokens: data.tokens, provider: "google" });
  void postSigninMigrate();
  return data.user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await postJson<{ ok: boolean; message: string }>("/api/auth/password-reset/request", {
    email: email.trim().toLowerCase(),
  });
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  await postJson<{ ok: boolean; message: string }>("/api/auth/password-reset/confirm", {
    token,
    new_password: newPassword,
  });
}

export async function logout(): Promise<void> {
  const { tokens } = getAuthState();
  try {
    if (tokens?.refresh_token) {
      await authFetch("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      });
    }
  } catch {
    // ignore — logout is best-effort. Always clear locally.
  }
  await clearAuth();
}

export async function probeMe(): Promise<AuthUser | null> {
  try {
    const resp = await authFetch("/api/auth/me", { method: "GET" });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.id) return null;
    // Sync any backend-side updates (e.g. providers attached on another device).
    const { tokens, provider } = getAuthState();
    if (tokens) await setAuth({ user: data, tokens, provider });
    return data as AuthUser;
  } catch {
    return null;
  }
}
